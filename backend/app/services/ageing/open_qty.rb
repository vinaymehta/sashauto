module Ageing
  # What is still to ship of an upload's order rows, for the ageing email (shipped quantities deducted). Deere's Qty is
  # already less what Deere received, so only shipments Deere has not received yet count: dated after the row's Last
  # Receipt Date (or with none). Shipped is read from the status of the row's order (its combined order's for a row of
  # one, Orders::Combiner):
  #   * Dispatched with its invoices one by one (OrderDelivery#invoice_lines, the dispatched orders list): the Qty of the
  #     invoices sent for this row, dated after the receipt;
  #   * otherwise (Dispatched set by hand, no invoice Qty; Delivered to SASH US or to Deere): all of it, when its latest
  #     status is dated after the receipt.
  #
  #   open = Ageing::OpenQty.new(batch.id)
  #   open.shipped(row)   # => 1400
  #   open.open(row)      # => 1200 (Qty less shipped, never below 0)
  class OpenQty
    SHIPPED_KINDS = %w[dispatched inbound outbound].freeze

    # `cache: false` while the upload is being processed (its rows are not committed yet).
    def initialize(batch_id, cache: true)
      combined = Orders::Combiner.call(batch_id, cache: cache)
      @anchor_of = combined.groups.values.select(&:combined?).flat_map { |g| g.members.map { |m| [ m.id, g.anchor_id ] } }.to_h
      @batch_id = batch_id
    end

    def shipped(row)
      marks = marks_for(order_key(row))
      return 0.to_d if marks.empty?

      pending = ->(date) { row.last_receipt_date.nil? || date > row.last_receipt_date }
      dispatched = marks["dispatched"]
      if dispatched&.invoice_lines.present? && !marks.key?("outbound")
        own = VendorOrderPlacement.order_key(row)
        return dispatched.invoice_lines.sum do |line|
          line["order_key"] == own && pending.(Date.iso8601(line["date"].to_s)) ? line["qty"].to_d : 0.to_d
        end
      end

      latest = marks.values.max_by { |mark| SHIPPED_KINDS.index(mark.kind) }
      pending.(latest.delivered_on) ? row.effective_qty.to_d : 0.to_d
    end

    def open(row)
      [ row.effective_qty.to_d - shipped(row), 0.to_d ].max
    end

    private

    # The order key the row's status is recorded on: its combined order's first row's, else its own.
    def order_key(row)
      anchor = @anchor_of[row.id]
      anchor && anchor != row.id ? anchor_keys[anchor] : VendorOrderPlacement.order_key(row)
    end

    def anchor_keys
      @anchor_keys ||= OrderRow.where(id: @anchor_of.values.uniq).to_h { |r| [ r.id, VendorOrderPlacement.order_key(r) ] }
    end

    # Active shipped statuses by order key ({ key => { kind => OrderDelivery } }), loaded once for the upload's keys.
    def marks_for(key)
      @marks ||= begin
        keys = OrderRow.where(upload_batch_id: @batch_id).map { |r| VendorOrderPlacement.order_key(r) } + anchor_keys.values
        OrderDelivery.active.where(kind: SHIPPED_KINDS, order_key: keys.uniq).group_by(&:order_key)
                     .transform_values { |list| list.index_by(&:kind) }
      end
      @marks.fetch(key, {})
    end
  end
end
