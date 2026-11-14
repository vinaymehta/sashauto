require "bigdecimal"

module Invoices
  # Which order rows take the Qty of an invoice's lines (Invoices::Reader), first in, first out: each line's Qty goes to
  # the orders of its PO + Part, oldest Ship Date first (then PO Line), each taking what it still has open, until the
  # line's Qty is used up. A line's Qty no order takes is unmatched, with the reason. Nothing is saved (see
  # Invoices::Import).
  #
  #   SASH India invoice (dispatched): first the rows the dispatched orders list names for this invoice number
  #     (OrderDelivery#invoice_lines, also of orders Deere has dropped since): the uploaded invoice takes the place of
  #     those list lines, which are not counted any more (Invoice.india_numbers). The rest goes to the Firm / Order
  #     rows of the current order data of the view's businesses (each business's latest upload, plus its manual
  #     orders) with the PO + Part; each takes its Balance: Order Qty less what was dispatched before on SASH India
  #     invoices and on the list (other invoices). An order Deere lists twice (same order key) counts once, the line
  #     with the Qty. Every row of an order (a combined order) marked Dispatched by hand, or Inbound / Outbound, without
  #     invoice dispatches is left out: sent before invoices were uploaded.
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
      @own_planned = Hash.new(0.to_d) # order key => Qty of the list's lines of this invoice taken by earlier lines
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
      named = dropped_candidates(line).merge(orders.to_h) # the list may name a delivery Deere has dropped since
      return [ [], "PO #{line.po_number} + Part #{line.part_number} has no Firm / Order row in the current order data" ] if named.empty?

      progress = Progress.for_keys(named.keys)
      take = lambda do |key, order, room, left|
        entry = progress[key]
        before = (entry&.shipped || 0.to_d) + listed_qty(key, order) + @planned[key]
        order_qty = [ entry ? entry.order_qty(order.qty) : order.qty.to_d, before + room ].max
        qty = [ room, left ].min
        @planned[key] += qty
        Allocation.new(line_index: line.index, order: order, order_key: key, order_qty: order_qty, qty: qty, before: before,
                       left: order_qty - before - qty, business: business_of(order))
      end
      left = line.qty
      # The rows the dispatched orders list names for this invoice: it takes the place of those list lines there.
      given = named.sort_by { |_, row| [ row.ship_date, row.po_line_number, row.id ] }.filter_map do |key, order|
        room = [ own_listed(key) - @own_planned[key], left ].min
        next unless room.positive?

        @own_planned[key] += room
        take.(key, order, room, left).tap { |a| left -= a.qty }
      end
      # The rest: the open orders, oldest first, each its Balance.
      open = orders.reject { |key, _| legacy_orders.include?(placement_key(key)) && !progress[key]&.shipped&.positive? && listed_qty(key, named[key]).zero? }
      return [ given, "the orders of this PO + Part are already marked Dispatched (before invoice uploads)" ] if open.empty? && given.empty?

      open.each do |key, order|
        break unless left.positive?

        entry = progress[key]
        before = (entry&.shipped || 0.to_d) + listed_qty(key, order) + @planned[key]
        room = (entry ? entry.order_qty(order.qty) : order.qty.to_d) - before
        next unless room.positive?

        given << take.(key, order, room, left).tap { |a| left -= a.qty }
      end
      [ given, "the orders of this PO + Part are dispatched in full (no Balance left)" ]
    end

    # Qty the dispatched orders list names for this (SASH India) invoice on the row with this key.
    def own_listed(key)
      @own_listed ||= OrderDelivery.active.where(kind: "dispatched").pluck(:invoice_lines).flatten
                                   .select { |l| l["invoice"] == @invoice.invoice_number }.group_by { |l| l["order_key"] }
                                   .transform_values { |lines| lines.sum(0.to_d) { |l| BigDecimal(l["qty"].presence || "0") } }
      @own_listed.fetch(key, 0.to_d)
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

        qty = (progress[key]&.shipped || 0.to_d) + listed_qty(key, order)
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
    # line has none) of invoices not uploaded as SASH India invoices (those count as invoices: Invoice.india_numbers,
    # and the one being read), or all of it when its order was marked Dispatched by hand (no lines).
    def listed_qty(key, order)
      @listed_lines ||= begin
        uploaded = Invoice.india_numbers
        uploaded << @invoice.invoice_number if @invoice.kind == "india"
        OrderDelivery.active.where(kind: "dispatched").pluck(:invoice_lines).flatten
                     .reject { |l| uploaded.include?(l["invoice"]) }.group_by { |l| l["order_key"] }
      end
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
