module Orders
  # The order lines of the current order data outside a request (Orders::LineFigures#summary_lines): each business's
  # latest upload, its manual orders and the rows kept from older uploads, as the Orders list shows them. Results are
  # cached until anything the lines read changes (LineFigures#lines_version).
  #
  #   Orders::CurrentLines.receipt_statuses          # own order key => "delivery" / "outbound" from Deere's receipts
  #   Orders::CurrentLines.receipt_delivered         # own order key => Qty delivered by Deere's receipts
  #   Orders::CurrentLines.undispatched_keys(%w[dtp]) # own order keys still waiting to be dispatched
  class CurrentLines
    include LineFigures

    attr_reader :businesses

    # Statuses from Deere's receipts (LineFigures#receipt_status) of every row of the businesses whose Delivered follows
    # Deere's receipts (LineFigures::RECEIPT_CHECKED), by the row's own order key.
    def self.receipt_statuses
      new(LineFigures::RECEIPT_CHECKED).receipt_status_map
    end

    # Qty delivered (LineFigures#receipts_delivered: SASH Inc invoices or Deere's receipts, the more) of every row of the
    # RECEIPT_CHECKED businesses, by the row's own order key (rows with nothing delivered left out).
    def self.receipt_delivered
      new(LineFigures::RECEIPT_CHECKED).receipt_delivered_map
    end

    # Own order keys of the rows still waiting to be dispatched: Qty open at Deere and nothing dispatched for them, also
    # not by goods recorded on an earlier ship date of their PO line (LineFigures#allocate_pending); never a charge.
    def self.undispatched_keys(businesses)
      new(businesses).undispatched
    end

    # Own order key => [Qty still to dispatch, its value] of the rows dispatched in part that still have Qty to dispatch
    # (Qty open at Deere; never a charge).
    def self.partly_sent(businesses)
      new(businesses).partly_sent_map
    end

    def initialize(businesses)
      @businesses = Array(businesses)
    end

    def receipt_status_map = cached(:receipt_statuses)
    def receipt_delivered_map = cached(:receipt_delivered)
    def undispatched = cached(:undispatched)
    def partly_sent_map = cached(:partly_sent)
    def qty_changes = cached(:qty_changes)

    private

    # The map `name` of the summary lines of the current order data. All maps are built from one pass over the lines and
    # cached together until the data changes: building the lines is the slow part (seconds), and a Dashboard request
    # reads several maps.
    def cached(name)
      batches = latest_batches
      Rails.cache.fetch([ "orders/current_lines/v5", businesses, lines_version(batches) ], expires_in: 30.minutes) do
        maps(lines(batches))
      end.fetch(name)
    end

    def maps(lines)
      {
        receipt_statuses: lines.each_with_object({}) { |l, map| (status = receipt_status(l)) && map[own_key(l[:row])] = status },
        receipt_delivered: lines.each_with_object({}) do |l, map|
          row = l[:row]
          next unless RECEIPT_CHECKED.include?(row[:business]) && !row[:manual] && !l[:charge] && l[:delivered].positive?

          map[own_key(row)] = l[:delivered]
        end,
        undispatched: lines.select { |l| !l[:charge] && l[:open].positive? && l[:shipped].zero? }.to_set { |l| own_key(l[:row]) },
        partly_sent: lines.select { |l| !l[:charge] && l[:open].positive? && l[:shipped].positive? && l[:pending].positive? }
                          .to_h { |l| [ own_key(l[:row]), [ l[:pending], l[:price] ? l[:pending] * l[:price] / 100 : 0.to_d ] ] },
        # [manual, id] => the line's Ordered, Dispatched and why they differ from the row's (OrdersController#qty_fields).
        qty_changes: lines.select { |l| l[:qty_change] }
                          .to_h { |l| [ [ l[:row][:manual] ? true : false, l[:row].id ], l.slice(:ordered, :shipped, :qty_change) ] }
      }
    end

    def latest_batches
      @latest_batches ||= businesses.filter_map { |b| UploadBatch.latest_completed(b) }
    end

    def lines(batches)
      load_combined_orders(Orders::Combiner.for_batches(batches.map(&:id)))
      summary_lines(dataset(batches).to_a)
    end

    def current_view?
      true
    end
  end
end
