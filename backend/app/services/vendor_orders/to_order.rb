require "bigdecimal"

module VendorOrders
  # The Qty of an order still to be made, which a vendor PO can be placed for: Deere's Qty of its rows (a combined
  # order's members, Orders::Combiner, else the row itself) less what SASH India has dispatched of each. A row is
  # dispatched in full by a Dispatched / Inbound / Outbound mark of its order (`mark_key`: the combined order's first
  # row's key, else its own; also a mark on its own key), unless the Dispatched mark lists the invoices sent row by
  # row (the former dispatched orders list, OrderDelivery#invoice_lines): then by its own lines. Or by its Qty on the
  # uploaded invoices (Invoices::Progress): all of it once Dispatched or further, else what is on SASH India invoices
  # (Dispatch: its Balance is still to make).
  #
  #   VendorOrders::ToOrder.call(group.members, mark_key: key)   # => #<Result qty=9287 dispatched=227 to_order=9060>
  class ToOrder
    Result = Data.define(:qty, :dispatched, :to_order)
    MADE_MARKS = %w[dispatched inbound outbound].freeze
    MADE_STATUSES = %w[dispatched delivery outbound].freeze # Invoices::Progress#status: dispatched in full

    def self.call(rows, mark_key:)
      new(rows, mark_key).call
    end

    def initialize(rows, mark_key)
      @rows = rows
      @mark_key = mark_key
    end

    def call
      keys = @rows.to_h { |row| [ row, VendorOrderPlacement.order_key(row) ] }
      marks = OrderDelivery.active.where(kind: MADE_MARKS, order_key: [ @mark_key, *keys.values ].uniq).group_by(&:order_key)
      progress = Invoices::Progress.for_keys(keys.values)
      qty = 0.to_d
      dispatched = 0.to_d
      @rows.each do |row|
        own = row.qty.to_d
        next unless own.positive?

        qty += own
        dispatched += [ dispatched_of(row, keys[row], (marks[@mark_key] || []) + (marks[keys[row]] || []), progress[keys[row]]), own ].min
      end
      Result.new(qty: qty, dispatched: dispatched, to_order: qty - dispatched)
    end

    private

    # Qty of the row SASH India has dispatched: all of it (a mark, or Dispatched or further on invoices), its lines on
    # the Dispatched mark of the list, or its Qty on SASH India invoices, whichever is most.
    def dispatched_of(row, key, marks, entry)
      qty = row.qty.to_d
      return qty if entry && MADE_STATUSES.include?(entry.status(row.qty))

      uploaded = Invoice.india_numbers # their list lines count as the invoices
      by_marks = marks.map do |mark|
        next qty if mark.kind != "dispatched" || mark.invoice_lines.blank?

        mark.invoice_lines.sum(0.to_d) do |line|
          next 0.to_d if line["order_key"] != key || uploaded.include?(line["invoice"])

          line["qty"].present? ? BigDecimal(line["qty"].to_s) : qty
        end
      end
      (by_marks.max || 0.to_d) + (entry&.shipped || 0.to_d)
    end
  end
end
