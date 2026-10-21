require "bigdecimal"

module Dashboard
  # Money figures of the dashboard, each with the series for its graph. Orders are counted as the Orders page lists
  # them (Dashboard::Overview): a combined order once, at the total of its rows and on its first row's ship date.
  # - open_sale: Deere orders still to deliver, i.e. Firm and Order orders of the latest upload, and active manual
  #   orders, without an active "Delivered to Deere" (outbound) mark. Value = Qty × Unit Price ÷ 100 (Deere prices per
  #   100 pcs; in the business's currency, Settings). by_date: value per ship date (the graph groups it by week or month).
  # - open_supplier: vendor POs whose order has no status mark yet (not Received at SASH Faridabad). Value = PO qty ×
  #   the vendor's unit price, per currency (there is no exchange rate). by_vendor: value per vendor and currency.
  # - ytd_customer_spend: Deere's Firm and Order orders with a ship date from the start of the financial year
  #   (1 April) to today: the last version of each order across every upload (rows of a combined order of the latest
  #   upload counted as that one order), plus manual orders. Same value as open_sale. by_date: value per ship date from
  #   series_from (the earlier of the financial year start and six months ago) to today, for the graph's Month /
  #   6 months / Year views.
  # The Unit Price is the order's own (file column "Unit Price"), else the part's customer price (Products).
  class Money
    TYPES = %w[Firm Order].freeze
    # One sale order: part, Qty, Unit Price text (per 100 pcs) and ship date.
    Sale = Data.define(:part, :qty, :price, :ship_date)

    def self.call(today: Time.find_zone!(AppConfig.ageing_time_zone).today, overview: nil)
      new(today, overview || Overview.new(today)).call
    end

    def initialize(today, overview)
      @today = today
      @overview = overview
    end

    def call
      { open_sale: open_sale, open_supplier: open_supplier, ytd_customer_spend: ytd_customer_spend }
    end

    private

    def open_sale
      open = @overview.open_orders
      totals(open.map { |o| [ o.ship_date, o.value, o.unpriced ] })
    end

    def ytd_customer_spend
      from = @today.month >= 4 ? Date.new(@today.year, 4, 1) : Date.new(@today.year - 1, 4, 1)
      series_from = [ from, (@today << 5).beginning_of_month ].min
      # Every row of each order's last version (the latest upload that has it); an order the file lists twice (e.g. once
      # without a Qty) counts once, with all of its rows.
      latest = OrderRow.where(order_type: TYPES, ship_date: series_from..@today)
                       .select("order_rows.*, MAX(upload_batch_id) OVER (PARTITION BY group_key, po_line_number, ship_date) AS latest_batch_id")
      rows = OrderRow.from(latest, :order_rows).where("order_rows.upload_batch_id = order_rows.latest_batch_id")
                     .where(upload_batch_id: UploadBatch.where(business: @overview.businesses).select(:id))
                     .pluck(:group_key, :po_line_number, :part_number, :qty, :ship_date, Arel.sql("source_data->>'Unit Price'"))
                     .map { |g, line, part, qty, ship, price| [ order_key(g, line, ship), Sale.new(part, qty, price, ship) ] }
      sales = rows + manual_orders(ship_date: series_from..@today)
      values = values_of(sales.map(&:last))
      # Rows of one combined order count as one order: its first (earliest) ship date, the total value.
      anchors = @overview.anchor_keys
      orders = sales.zip(values).group_by { |(key, _), _| anchors[key] || key }.values.map do |list|
        [ list.map { |(_, sale), _| sale.ship_date }.min, list.sum(BigDecimal("0")) { |_, v| v || 0 }, list.any? { |_, v| v.nil? } ]
      end
      ytd = orders.select { |ship, *| ship >= from }
      totals(ytd).merge(from: from, to: @today, series_from: series_from, by_date: by_date(orders))
    end

    # { amount, orders, without_price, currency, by_date } of [ship date, value, unpriced] orders.
    def totals(orders)
      { amount: money(orders.sum(BigDecimal("0")) { |_, v, _| v }), orders: orders.size, without_price: orders.count { |*, unpriced| unpriced },
        currency: @overview.currency, by_date: by_date(orders) }
    end

    # [{ date, amount }] of [ship date, value, unpriced] orders by ship date.
    def by_date(orders)
      orders.group_by(&:first).sort.map { |date, list| { date: date, amount: money(list.sum(BigDecimal("0")) { |_, v, _| v }) } }
    end

    def open_supplier
      # POs of the view's businesses: placed for one of their uploads' rows or manual orders.
      own = VendorOrderPlacement.where(upload_batch_id: UploadBatch.where(business: @overview.businesses).select(:id))
                                .or(VendorOrderPlacement.where(manual_order_id: ManualOrder.where(business: @overview.businesses).select(:id)))
      orders = VendorOrder.joins(:vendor_order_placement, :vendor).where(vendor_order_placement_id: own.select(:id))
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

    # Active manual orders of type Firm / Order: [[order key, Sale], ...].
    def manual_orders(**where)
      ManualOrder.active.where(business: @overview.businesses, order_type: TYPES, **where)
                 .pluck(:id, :part_number, :qty, Arel.sql("source_data->>'Unit Price'"), :ship_date)
                 .map { |id, part, qty, price, ship| [ VendorOrderPlacement.order_key(ManualOrder.new(id: id)), Sale.new(part, qty, price, ship) ] }
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
