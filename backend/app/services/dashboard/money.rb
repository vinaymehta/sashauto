require "bigdecimal"

module Dashboard
  # Money figures of the dashboard, each with the series for its graph:
  # - open_sale: Deere orders still to deliver, i.e. Firm and Order rows of the latest upload, and active manual
  #   orders, without an active "Delivered to Deere" (outbound) mark. Value = Qty × Unit Price ÷ 100 (Deere prices per
  #   100 pcs; USD). by_date: value per ship date (the graph groups it by week or month).
  # - open_supplier: vendor POs whose order has no status mark yet (not Received at SASH Faridabad). Value = PO qty ×
  #   the vendor's unit price, per currency (there is no exchange rate). by_vendor: value per vendor and currency.
  # - ytd_customer_spend: Deere's Firm and Order orders with a ship date from the start of the financial year
  #   (1 April) to today: the last version of each order across every upload, plus manual orders. Same value as
  #   open_sale. by_date: value per ship date from series_from (the earlier of the financial year start and six months
  #   ago) to today, for the graph's Month / 6 months / Year views.
  # The Unit Price is the order's own (file column "Unit Price"), else the part's customer price (Products).
  class Money
    TYPES = %w[Firm Order].freeze
    SALE_CURRENCY = "USD"
    # One sale order: part, Qty, Unit Price text (per 100 pcs) and ship date.
    Sale = Data.define(:part, :qty, :price, :ship_date)

    def self.call(today: Time.find_zone!(AppConfig.ageing_time_zone).today)
      new(today).call
    end

    def initialize(today)
      @today = today
    end

    def call
      { open_sale: open_sale, open_supplier: open_supplier, ytd_customer_spend: ytd_customer_spend }
    end

    private

    def open_sale
      batch = UploadBatch.latest_completed
      rows = batch ? OrderRow.where(upload_batch_id: batch.id, order_type: TYPES).pluck(:group_key, :po_line_number, :ship_date, :part_number, :qty, Arel.sql("source_data->>'Unit Price'")) : []
      keyed = rows.map { |g, line, ship, part, qty, price| [ order_key(g, line, ship), Sale.new(part, qty, price, ship) ] } +
              manual_orders.map { |id, sale| [ VendorOrderPlacement.order_key(ManualOrder.new(id: id)), sale ] }
      delivered = OrderDelivery.active.where(kind: "outbound", order_key: keyed.map(&:first)).distinct.pluck(:order_key).to_set
      sales = keyed.reject { |key, _| delivered.include?(key) }.map(&:last)
      sale_total(sales).merge(by_date: by_date(sales))
    end

    def ytd_customer_spend
      from = @today.month >= 4 ? Date.new(@today.year, 4, 1) : Date.new(@today.year - 1, 4, 1)
      series_from = [ from, (@today << 5).beginning_of_month ].min
      rows = OrderRow.where(order_type: TYPES, ship_date: series_from..@today)
                     .select("DISTINCT ON (group_key, po_line_number, ship_date) part_number, qty, ship_date, source_data->>'Unit Price' AS unit_price")
                     .order(:group_key, :po_line_number, :ship_date, upload_batch_id: :desc)
                     .map { |r| Sale.new(r.part_number, r.qty, r.unit_price, r.ship_date) }
      sales = rows + manual_orders(ship_date: series_from..@today).map(&:last)
      ytd = sales.select { |s| s.ship_date >= from }
      sale_total(ytd).merge(from: from, to: @today, series_from: series_from, by_date: by_date(sales))
    end

    def open_supplier
      orders = VendorOrder.joins(:vendor_order_placement, :vendor)
                          .pluck("vendor_order_placements.order_key", :qty, :unit_price, :price_currency, "vendors.name")
      marked = OrderDelivery.active.where(order_key: orders.map(&:first).uniq).distinct.pluck(:order_key).to_set
      open = orders.reject { |key, *| marked.include?(key) }
      priced, unpriced = open.partition { |_, _, price, _, _| price }
      currency = ->(c) { c.presence || "INR" }
      totals = priced.group_by { |o| currency.(o[3]) }
                     .map { |c, list| { currency: c, amount: money(list.sum { |o| o[1] * o[2] }) } }
                     .sort_by { |t| -t[:amount].to_d }
      by_vendor = priced.group_by { |o| [ o[4], currency.(o[3]) ] }
                        .map { |(vendor, c), list| { vendor: vendor, currency: c, amount: money(list.sum { |o| o[1] * o[2] }) } }
                        .sort_by { |t| -t[:amount].to_d }
      { by_currency: totals, orders: open.size, without_price: unpriced.size, by_vendor: by_vendor }
    end

    # Active manual orders of type Firm / Order: [[id, Sale], ...].
    def manual_orders(**where)
      ManualOrder.active.where(order_type: TYPES, **where)
                 .pluck(:id, :part_number, :qty, Arel.sql("source_data->>'Unit Price'"), :ship_date)
                 .map { |id, part, qty, price, ship| [ id, Sale.new(part, qty, price, ship) ] }
    end

    # { amount, orders, without_price, currency } of sale orders.
    def sale_total(sales)
      values = values_of(sales)
      { amount: money(values.compact.sum(BigDecimal("0"))), orders: sales.size, without_price: values.count(nil), currency: SALE_CURRENCY }
    end

    # [{ date, amount }] of sale orders by ship date.
    def by_date(sales)
      totals = Hash.new(BigDecimal("0"))
      sales.zip(values_of(sales)).each { |sale, value| totals[sale.ship_date] += value if value }
      totals.keys.sort.map { |d| { date: d, amount: money(totals[d]) } }
    end

    # Each sale's value (Qty × price per 100 pcs ÷ 100), nil without a price. Cached per list.
    def values_of(sales)
      @values ||= {}.compare_by_identity
      @values[sales] ||= begin
        fallback = Product.where(part_number: sales.map(&:part).uniq).pluck(:part_number, :customer_price).to_h
        sales.map do |sale|
          price = number(sale.price) || fallback[sale.part]
          price && sale.qty.to_d * price / 100
        end
      end
    end

    def order_key(group_key, po_line_number, ship_date)
      Digest::SHA256.hexdigest([ group_key, po_line_number, ship_date.iso8601 ].join(OrderRows::Normalizer::KEY_SEPARATOR))
    end

    def number(text)
      value = text.to_s.delete(",").strip
      value.match?(/\A\d+(\.\d+)?\z/) ? BigDecimal(value) : nil
    end

    def money(value)
      value.round(2).to_s("F")
    end
  end
end
