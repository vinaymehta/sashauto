require "bigdecimal"

module Invoices
  # What the uploaded invoices did to orders, by order key (VendorOrderPlacement.order_key of the row itself, not its
  # combined order's): Qty dispatched on SASH India invoices (shipped), Qty delivered to Deere on SASH Inc invoices
  # (outbound) and each invoice move.
  #
  # Order Qty of a row with dispatches: the highest of its Qty now and its Qty when each dispatch was recorded. Deere's
  # Qty in later files is what is still open (it drops once Deere receives goods, and the row leaves the file when all
  # is received), so the Qty at dispatch keeps the order's own Qty; a Qty Deere raises later still counts. (A Qty Deere
  # lowers after the first dispatch is not followed.) Balance = Order Qty − shipped.
  #
  # Status from the invoices (the Orders page's SQL does the same, Api::OrdersController::INVOICE_STATUS_SQL):
  #   outbound    outbound >= Order Qty (fulfilled)
  #   dispatched  shipped >= Order Qty (all sent from India)
  #   dispatch    0 < shipped < Order Qty (part sent, Balance still to send)
  #
  #   progress = Invoices::Progress.for_keys(keys)
  #   progress[key]&.status(row.qty)   # => "dispatch"
  class Progress
    Move = Data.define(:kind, :invoice_id, :invoice_number, :invoice_date, :qty)

    Entry = Data.define(:shipped, :outbound, :dispatched_order_qty, :moves) do
      # Order Qty for a row whose Qty is now `qty` (see above).
      def order_qty(qty)
        [ qty.to_d, dispatched_order_qty.to_d ].max
      end

      def balance(qty)
        [ order_qty(qty) - shipped, 0.to_d ].max
      end

      def status(qty)
        total = order_qty(qty)
        # Delivered in full first: an order dispatched by the dispatched orders list has no SASH India invoice Qty.
        return "outbound" if outbound.positive? && outbound >= total
        return nil unless shipped.positive?
        return "dispatched" if shipped >= total

        "dispatch"
      end
    end

    # { order key => Entry } for the keys with allocations of active invoices.
    def self.for_keys(keys)
      return {} if keys.empty?

      InvoiceAllocation.active.where(order_key: keys.uniq)
                       .order("invoices.invoice_date", "invoices.id", :id)
                       .pluck(:order_key, "invoices.kind", "invoices.id", "invoices.invoice_number", "invoices.invoice_date", :qty, :order_qty)
                       .group_by(&:first).transform_values { |list| entry(list) }
    end

    def self.entry(list)
      india = list.select { |row| row[1] == "india" }
      Entry.new(shipped: india.sum(0.to_d) { |row| row[5] }, outbound: list.select { |row| row[1] == "inc" }.sum(0.to_d) { |row| row[5] },
                dispatched_order_qty: list.filter_map(&:last).max || 0.to_d, # SASH Inc lines keep the Qty sent (dispatched orders list)
                moves: list.map { |_, kind, id, number, date, qty, _| Move.new(kind: kind, invoice_id: id, invoice_number: number, invoice_date: date, qty: qty) })
    end
    private_class_method :entry

    # The order keys of `rows` ([[order key, Qty now], ...]) delivered to Deere in full on SASH Inc invoices.
    def self.fulfilled_keys(rows)
      progress = for_keys(rows.map(&:first))
      rows.filter_map { |key, qty| key if progress[key]&.status(qty) == "outbound" }.to_set
    end
  end
end
