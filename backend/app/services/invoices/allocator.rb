require "bigdecimal"

module Invoices
  # Which order rows take the Qty of an invoice's lines (Invoices::Reader), first in, first out: each line's Qty goes to
  # the orders of its PO + Part, oldest Ship Date first (then PO Line), each taking what it still has open, until the
  # line's Qty is used up. A line's Qty no order takes is unmatched, with the reason. Nothing is saved (see
  # Invoices::Import).
  #
  #   SASH India invoice (dispatched): the Firm / Order rows of the current order data of the view's businesses (each
  #     business's latest upload, plus its manual orders) with the PO + Part; each takes its Balance (Order Qty less
  #     dispatched before, Invoices::Progress). An order Deere lists twice (same order key) counts once, the line with
  #     the Qty. Rows sent before invoices were uploaded (and without invoice dispatches) are left out: those a
  #     Dispatched mark of the former dispatched orders list names (OrderDelivery#invoice_lines), and every row of an
  #     order (a combined order) marked Dispatched by hand, or Inbound / Outbound.
  #   SASH Inc invoice (outbound): the orders of the PO + Part dispatched on SASH India invoices or the dispatched
  #     orders list, also those Deere has received and dropped from its file since (OrderRow.dropped: kept on Orders by
  #     their mark); each takes what is still in transit (dispatched less outbound before), oldest Ship Date first.
  #
  #   plan = Invoices::Allocator.call(invoice, view: "dtp")   # => Plan
  class Allocator
    # order: the OrderRow or ManualOrder; order_qty: its Order Qty; before: dispatched (India) or outbound (Inc) before
    # this invoice; left: after it, its Balance (India) or Qty still in transit (Inc).
    Allocation = Data.define(:line_index, :order, :order_key, :order_qty, :qty, :before, :left, :business)
    Unmatched = Data.define(:line_index, :po_number, :part_number, :qty, :reason)
    Plan = Data.define(:allocations, :unmatched)

    LEGACY_KINDS = %w[dispatched inbound outbound].freeze

    def self.call(invoice, view:)
      new(invoice, view).call
    end

    def initialize(invoice, view)
      @invoice = invoice
      @view = view
      @planned = Hash.new(0.to_d) # order key => Qty given by earlier lines of this invoice
    end

    def call
      allocations = []
      unmatched = []
      @invoice.lines.each do |line|
        given, reason = @invoice.kind == "india" ? dispatch(line) : deliver(line)
        allocations.concat(given)
        left = line.qty - given.sum(0.to_d, &:qty)
        next unless left.positive?

        unmatched << Unmatched.new(line_index: line.index, po_number: line.po_number, part_number: line.part_number, qty: left,
                                   reason: given.any? ? "#{Serializers.qty(left)} more than the orders of this PO + Part have open" : reason)
      end
      Plan.new(allocations: allocations, unmatched: unmatched)
    end

    private

    # SASH India invoice line: [allocations, reason when none].
    def dispatch(line)
      return [ [], "no PO No. above this item on the invoice" ] unless line.po_number

      orders = candidates(line)
      return [ [], "PO #{line.po_number} + Part #{line.part_number} has no Firm / Order row in the current order data" ] if orders.empty?

      progress = Progress.for_keys(orders.map(&:first))
      open = orders.reject { |key, _| legacy?(key) && !progress[key]&.shipped&.positive? }
      return [ [], "the orders of this PO + Part are already marked Dispatched (before invoice uploads)" ] if open.empty?

      left = line.qty
      given = open.filter_map do |key, order|
        entry = progress[key]
        order_qty = entry ? entry.order_qty(order.qty) : order.qty.to_d
        before = (entry&.shipped || 0.to_d) + @planned[key]
        qty = [ order_qty - before, left ].min
        next unless qty.positive?

        left -= qty
        @planned[key] += qty
        Allocation.new(line_index: line.index, order: order, order_key: key, order_qty: order_qty, qty: qty, before: before,
                       left: order_qty - before - qty, business: business_of(order))
      end
      [ given, "the orders of this PO + Part are dispatched in full (no Balance left)" ]
    end

    # SASH Inc invoice line: [allocations, reason when none]. The orders of the PO + Part that were sent from India (on
    # SASH India invoices, or on the dispatched orders list: its Qty there), oldest Ship Date first; each takes what is
    # still in transit (sent less outbound before).
    def deliver(line)
      return [ [], "no PO No. above this item on the invoice" ] unless line.po_number

      india = InvoiceAllocation.active.where(invoices: { kind: "india" }, po_number: line.po_number, part_number: line.part_number)
                               .includes(order_row: :upload_batch, manual_order: []).to_a.group_by(&:order_key)
      rows = dropped_candidates(line).merge(candidates(line).to_h)
      keys = (india.keys + rows.keys).uniq
      progress = Progress.for_keys(keys)
      sent = keys.filter_map do |key|
        order = rows[key] || india[key]&.last&.then { |a| a.order_row || a.manual_order }
        next unless order

        qty = (progress[key]&.shipped || 0.to_d) + (india.key?(key) ? 0.to_d : listed_qty(key, order))
        [ key, order, qty ] if qty.positive?
      end
      if sent.empty?
        return [ [], "nothing of PO #{line.po_number} + Part #{line.part_number} was dispatched (SASH India invoice or dispatched orders list)" ]
      end

      left = line.qty
      ordered = sent.sort_by { |_, order, _| [ order.ship_date, order.po_line_number, order.is_a?(ManualOrder) ? 1 : 0, order.id ] }
      given = ordered.filter_map do |key, order, shipped|
        entry = progress[key]
        before = (entry&.outbound || 0.to_d) + @planned[key]
        qty = [ shipped - before, left ].min
        next unless qty.positive?

        left -= qty
        @planned[key] += qty
        # Order Qty: at least what was sent (Deere's Qty drops as it receives, e.g. 4 open of 150 sent on the list).
        order_qty = [ entry ? entry.order_qty(order.qty) : order.qty.to_d, shipped ].max
        Allocation.new(line_index: line.index, order: order, order_key: key, order_qty: order_qty, qty: qty,
                       before: before, left: shipped - before - qty, business: business_of(order))
      end
      [ given, "everything dispatched of this PO + Part is already delivered (outbound)" ]
    end

    # Qty of the row with this key sent on the dispatched orders list: its lines there (their Qty, the row's Qty when a
    # line has none), or all of it when its order was marked Dispatched by hand (no lines).
    def listed_qty(key, order)
      @listed_lines ||= OrderDelivery.active.where(kind: "dispatched").pluck(:invoice_lines).flatten
                                     .group_by { |l| l["order_key"] }
      lines = @listed_lines[key]
      return lines.sum(0.to_d) { |l| l["qty"].present? ? BigDecimal(l["qty"].to_s) : order.qty.to_d } if lines

      legacy_orders.include?(placement_key(key)) && OrderDelivery.active.exists?(order_key: placement_key(key), kind: "dispatched") ? order.qty.to_d : 0.to_d
    end

    # [[order key, row], ...] of the line's PO + Part, oldest Ship Date first: imported Firm / Order rows of the latest
    # uploads (one per order key: the one with the Qty) and manual orders.
    def candidates(line)
      imported = OrderRow.where(upload_batch_id: batch_ids, po_number: line.po_number, part_number: line.part_number, order_type: %w[Firm Order])
                         .includes(:upload_batch).to_a
                         .group_by { |row| VendorOrderPlacement.order_key(row) }
                         .transform_values { |rows| rows.max_by { |row| [ row.qty.to_d, -row.id ] } }
      manual = ManualOrder.active.where(business: Business.of(@view), po_number: line.po_number, part_number: line.part_number, order_type: %w[Firm Order])
                          .to_h { |order| [ VendorOrderPlacement.order_key(order), order ] }
      imported.merge(manual).sort_by { |_, row| [ row.ship_date, row.po_line_number, row.is_a?(ManualOrder) ? 1 : 0, row.id ] }
    end

    # { order key => row } of the line's PO + Part no longer in the current order data (OrderRow.dropped).
    def dropped_candidates(line)
      OrderRow.dropped(batch_ids, po_number: line.po_number, part_number: line.part_number).includes(:upload_batch)
              .to_h { |row| [ VendorOrderPlacement.order_key(row), row ] }
    end

    def batch_ids
      @batch_ids ||= UploadBatch.latest_for(@view).map(&:id)
    end

    # Whether the row with this key was sent before invoice uploads (see above).
    def legacy?(key)
      legacy_rows.include?(key) || legacy_orders.include?(placement_key(key))
    end

    # Keys of the rows named on Dispatched marks of the former dispatched orders list.
    def legacy_rows
      load_legacy
      @legacy_rows
    end

    # Keys of the orders marked Dispatched by hand (no invoice lines), Inbound or Outbound.
    def legacy_orders
      load_legacy
      @legacy_orders
    end

    def load_legacy
      return if @legacy_rows

      @legacy_rows = Set.new
      @legacy_orders = Set.new
      OrderDelivery.active.where(kind: LEGACY_KINDS).pluck(:order_key, :kind, :invoice_lines).group_by(&:first).each do |key, marks|
        lines = marks.flat_map(&:last)
        if marks.all? { |_, kind, _| kind == "dispatched" } && lines.any?
          @legacy_rows.merge(lines.filter_map { |line| line["order_key"] })
        else
          @legacy_orders << key
        end
      end
    end

    # The key the status marks of an order are on: its combined order's (first row's) for a row of one.
    def placement_key(key)
      combined_keys.fetch(key, key)
    end

    # order key of each row of a combined order of the latest uploads => its combined order's key.
    def combined_keys
      @combined_keys ||= Orders::Combiner.for_batches(batch_ids).groups.values.select(&:combined?).each_with_object({}) do |group, keys|
        anchor = VendorOrderPlacement.order_key(group.members.find { |m| m.id == group.anchor_id })
        group.members.each { |m| keys[VendorOrderPlacement.order_key(m)] = anchor }
      end
    end

    def business_of(order)
      order.is_a?(ManualOrder) ? order.business : order.upload_batch&.business
    end
  end
end
