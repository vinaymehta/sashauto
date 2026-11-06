module Invoices
  # An uploaded SASH invoice file, from Orders → Actions → Upload invoice (`kind`: "india" or "inc", or nil: the kind
  # the file is): read (Invoices::Reader),
  # checked (the invoice is of that kind, its number not uploaded before) and allocated (Invoices::Allocator). `preview`
  # saves nothing; `save` reads and allocates again (the orders may have changed since the preview) and records the
  # invoice with its file, lines, unmatched lines and allocations, in one transaction.
  #
  #   import = Invoices::Import.new(path:, filename:, kind: "india", view: "dtp", user:)
  #   import.preview   # => Hash (the invoice, each line with the order rows it goes to, the unmatched Qty)
  #   import.save      # => [Invoice, Hash]
  class Import
    class Rejected < StandardError; end

    def initialize(path:, filename:, kind:, view:, user:)
      @path = path
      @filename = filename.to_s
      @kind = kind
      @view = view
      @user = user
    end

    def preview
      invoice = read
      summary(invoice, Allocator.call(invoice, view: @view))
    end

    def save
      Invoice.transaction do
        # One invoice saved at a time: each allocates from what the ones before it took.
        Invoice.connection.execute("SELECT pg_advisory_xact_lock(#{Zlib.crc32('invoices')})")
        invoice = read
        plan = Allocator.call(invoice, view: @view)
        record = create(invoice, plan)
        [ record, summary(invoice, plan).merge(id: record.id) ]
      end
    rescue ActiveRecord::RecordNotUnique
      raise Rejected, "This invoice was just uploaded by someone else."
    end

    private

    def read
      invoice = Reader.call(path: @path, filename: @filename)
      @kind ||= invoice.kind # no kind given: the one the file is (SASH India or SASH Inc, by its Exporter)
      if invoice.kind != @kind
        raise Rejected, "This is a #{Invoice::LABELS.fetch(invoice.kind)} (exporter #{invoice.exporter || 'unknown'}), not a " \
                        "#{Invoice::LABELS.fetch(@kind)}. Upload it with \"Upload #{Invoice::LABELS.fetch(invoice.kind)}\"."
      end
      if (earlier = Invoice.active.find_by(kind: @kind, invoice_number: invoice.invoice_number))
        raise Rejected, "#{Invoice::LABELS.fetch(@kind)} #{invoice.invoice_number} was already uploaded on " \
                        "#{earlier.created_at.in_time_zone(AppConfig.ageing_time_zone).strftime('%d %b %Y')} by #{earlier.uploaded_by.name}."
      end
      invoice
    rescue Reader::InvalidFile => e
      raise Rejected, e.message
    end

    def create(invoice, plan)
      matched = plan.allocations.sum(0.to_d, &:qty)
      businesses = plan.allocations.map(&:business).compact.uniq
      record = Invoice.create!(
        kind: @kind, invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date, exporter: invoice.exporter&.first(255),
        business: businesses.one? ? businesses.first : (Business::KEYS.include?(@view) ? @view : nil),
        original_filename: @filename.first(255), lines: invoice.lines.map { |line| line_json(line) },
        unmatched_lines: plan.unmatched.map { |u| u.to_h.merge(qty: Serializers.qty(u.qty)) },
        total_qty: invoice.lines.sum(&:qty), matched_qty: matched, uploaded_by: @user
      )
      now = Time.current
      rows = plan.allocations.map do |a|
        order = a.order
        { invoice_id: record.id, line_index: a.line_index, order_key: a.order_key,
          order_row_id: order.is_a?(OrderRow) ? order.id : nil, manual_order_id: order.is_a?(ManualOrder) ? order.id : nil,
          po_number: order.po_number, po_line_number: order.po_line_number, part_number: order.part_number, order_type: order.order_type,
          ship_date: order.ship_date, order_qty: a.order_qty, qty: a.qty, created_at: now }
      end
      InvoiceAllocation.insert_all!(rows) if rows.any?
      record.file.attach(io: File.open(@path), filename: @filename.first(255).presence || "invoice")
      AuditLog.record("invoice.uploaded", subject: record, user: @user, kind: @kind, invoice_number: record.invoice_number,
                                          lines: invoice.lines.size, total_qty: Serializers.qty(record.total_qty),
                                          matched_qty: Serializers.qty(matched), unmatched: plan.unmatched.size)
      record
    end

    def line_json(line)
      { index: line.index, po_number: line.po_number, po_date: line.po_date&.iso8601, part_number: line.part_number,
        description: line.description, qty: Serializers.qty(line.qty) }
    end

    # The invoice and what it does: each line with the order rows it goes to (Qty, Order Qty, dispatched / outbound
    # before and after, and the Balance / Qty in transit left), and the Qty no order takes.
    def summary(invoice, plan)
      by_line = plan.allocations.group_by(&:line_index)
      unmatched = plan.unmatched.index_by(&:line_index)
      {
        kind: @kind, label: Invoice::LABELS.fetch(@kind), exporter: invoice.exporter, invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date, filename: @filename, warnings: invoice.warnings,
        total_qty: Serializers.qty(invoice.lines.sum(&:qty)), matched_qty: Serializers.qty(plan.allocations.sum(0.to_d, &:qty)),
        unmatched_qty: Serializers.qty(plan.unmatched.sum(0.to_d, &:qty)),
        lines: invoice.lines.map do |line|
          line_json(line).merge(
            allocations: by_line.fetch(line.index, []).map { |a| allocation_json(a) },
            unmatched_qty: unmatched[line.index] && Serializers.qty(unmatched[line.index].qty), reason: unmatched[line.index]&.reason
          )
        end
      }
    end

    def allocation_json(allocation)
      order = allocation.order
      { order_id: order.id, manual: order.is_a?(ManualOrder), business: allocation.business, order_type: order.order_type,
        po_line_number: order.po_line_number, ship_date: order.ship_date, qty_now: Serializers.qty(order.qty),
        order_qty: Serializers.qty(allocation.order_qty), before: Serializers.qty(allocation.before), qty: Serializers.qty(allocation.qty),
        after: Serializers.qty(allocation.before + allocation.qty), left: Serializers.qty(allocation.left) }
    end
  end
end
