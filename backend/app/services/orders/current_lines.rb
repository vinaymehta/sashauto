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

    # Statuses from Deere's receipts (LineFigures#receipt_status) of every row of the businesses whose deliveries are
    # not on SASH Inc invoices (GMBH), by the row's own order key.
    def self.receipt_statuses
      new(LineFigures::RECEIPT_BUSINESSES).receipt_status_map
    end

    # Qty delivered by Deere's receipts (LineFigures#receipts_delivered) of every row of the businesses whose deliveries
    # are not on SASH Inc invoices (GMBH), by the row's own order key (rows with nothing delivered left out).
    def self.receipt_delivered
      new(LineFigures::RECEIPT_BUSINESSES).receipt_delivered_map
    end

    # Own order keys of the rows still waiting to be dispatched: Qty open at Deere and nothing dispatched for them, also
    # not by goods recorded on an earlier ship date of their PO line (LineFigures#allocate_pending); never a charge.
    def self.undispatched_keys(businesses)
      new(businesses).undispatched
    end

    def initialize(businesses)
      @businesses = Array(businesses)
    end

    def receipt_status_map
      cached("receipt_statuses") do |lines|
        lines.each_with_object({}) { |l, map| (status = receipt_status(l)) && map[own_key(l[:row])] = status }
      end
    end

    def receipt_delivered_map
      cached("receipt_delivered") do |lines|
        lines.each_with_object({}) do |l, map|
          row = l[:row]
          next unless RECEIPT_BUSINESSES.include?(row[:business]) && !row[:manual] && !l[:charge] && l[:delivered].positive?

          map[own_key(row)] = l[:delivered]
        end
      end
    end

    def undispatched
      cached("undispatched") do |lines|
        lines.select { |l| !l[:charge] && l[:open].positive? && l[:shipped].zero? }.to_set { |l| own_key(l[:row]) }
      end
    end

    private

    # The block's result for the summary lines of the current order data, cached under `name` until the data changes.
    def cached(name)
      batches = latest_batches
      Rails.cache.fetch([ "orders/current_lines/#{name}/v1", businesses, lines_version(batches) ], expires_in: 30.minutes) do
        yield lines(batches)
      end
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
