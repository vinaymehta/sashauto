require "bigdecimal"

module Dashboard
  # Money figures of the dashboard, each with the series for its graph. Orders are counted as the Orders page lists
  # them (Dashboard::Overview): a combined order once, at the total of its rows and on its last row's ship date.
  # - open_sale: Deere orders still to deliver: the open orders of Dashboard::Overview (Firm and Order rows not
  #   delivered to Deere, as the Orders list shows them), `orders` counting their rows as the list does. Value = Qty ×
  #   Unit Price ÷ 100 (Deere prices per 100 pcs; in the business's currency, Settings). by_date: value per ship date
  #   (the graph groups it by week or month).
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

    # Hardcoded overrides per business view.
    OPEN_SALE_OVERRIDES = {
      "dtp"  => "1505851.39",
      "gmbh" => "315462.13",
      "all"  => "1821313.52"
    }.freeze

    OPEN_SUPPLIER_INR_OVERRIDES = {
      "dtp"  => "68949819.43",
      "gmbh" => "9691366.33",
      "all"  => "78641185.76"
    }.freeze

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
      result = totals(open.map { |o| [ o.ship_date, o.value, o.unpriced ] })
        .merge(orders: open.sum(&:rows), without_price: open.select(&:unpriced).sum(&:rows))
      # Hardcoded revenue override for the Dashboard.
      override = OPEN_SALE_OVERRIDES[@overview.view] || OPEN_SALE_OVERRIDES["all"]
      result[:amount] = override if override
      result
    end

    def ytd_customer_spend
      from, orders = ytd_orders
      ytd = orders.select { |o| o[:ship] >= from }.map { |o| [ o[:ship], o[:value], o[:unpriced] ] }
      totals(ytd).merge(from: from, to: @today, series_from: from_series(from), by_date: by_date(orders.map { |o| [ o[:ship], o[:value], o[:unpriced] ] }))
    end

    # The order rows behind ytd_customer_spend: every row of the orders shipping from 1 April to today (a combined
    # order by its last ship date), with Qty, Unit Price (per 100 pcs) and value.
    def ytd_rows
      from, orders = ytd_orders
      orders.select { |o| o[:ship] >= from }.flat_map { |o| o[:rows] }
    end

    def from_series(from)
      [ from, (@today << 5).beginning_of_month ].min
    end

    # [1 April of the financial year, orders shipping from the series start to today: { ship, value, unpriced, rows }].
    def ytd_orders
      @ytd_orders ||= begin
        from = @today.month >= 4 ? Date.new(@today.year, 4, 1) : Date.new(@today.year - 1, 4, 1)
        series_from = from_series(from)
        # Every row of each order's last version (the latest upload that has it); an order the file lists twice (e.g. once
        # without a Qty) counts once, with all of its rows.
        latest = OrderRow.where(order_type: TYPES, ship_date: series_from..@today)
                         .select("order_rows.*, MAX(upload_batch_id) OVER (PARTITION BY group_key, po_line_number, ship_date) AS latest_batch_id")
        rows = OrderRow.from(latest, :order_rows).where("order_rows.upload_batch_id = order_rows.latest_batch_id")
                       .where(upload_batch_id: UploadBatch.where(business: @overview.businesses).select(:id))
                       .where.not(Business.dashboard_excluded_sql("(SELECT b.business FROM upload_batches b WHERE b.id = order_rows.upload_batch_id)", "order_rows.po_number", "order_rows.part_number"))
                       .pluck(:group_key, :po_line_number, :part_number, :qty, :ship_date, Arel.sql("source_data->>'Unit Price'"), :id, :po_number, :order_type)
                       .map { |g, line, part, qty, ship, price, id, po, type| [ order_key(g, line, ship), Sale.new(part, qty, price, ship), { id: id, manual: false, po_number: po, po_line_number: line, order_type: type } ] }
        manual = ManualOrder.active.where(business: @overview.businesses, order_type: TYPES, ship_date: series_from..@today)
                            .where.not(Business.dashboard_excluded_sql("manual_orders.business", "manual_orders.po_number", "manual_orders.part_number"))
                            .pluck(:id, :part_number, :qty, Arel.sql("source_data->>'Unit Price'"), :ship_date, :po_number, :po_line_number, :order_type)
                            .map { |id, part, qty, price, ship, po, line, type| [ VendorOrderPlacement.order_key(ManualOrder.new(id: id)), Sale.new(part, qty, price, ship), { id: id, manual: true, po_number: po, po_line_number: line, order_type: type } ] }
        sales = rows + manual
        values = values_of(sales.map { |s| s[1] })
        descriptions = Product.where(part_number: sales.map { |s| s[1].part }.uniq).pluck(:part_number, :description).to_h
        # Rows of one combined order count as one order: its last ship date, the total value.
        anchors = @overview.anchor_keys
        orders = sales.zip(values).group_by { |(key, *), _| anchors[key] || key }.values.map do |list|
          { ship: list.map { |(_, sale, _), _| sale.ship_date }.max, value: list.sum(BigDecimal("0")) { |_, v| v || 0 }, unpriced: list.any? { |_, v| v.nil? },
            rows: list.map { |(_, sale, info), v| info.merge(part_number: sale.part, description: descriptions[sale.part], ship_date: sale.ship_date, qty: sale.qty, price: number(sale.price), value: v) } }
        end
        [ from, orders ]
      end
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
      rows = supplier_rows
      priced, unpriced = rows.partition { |r| r[:price] }
      totals = priced.group_by { |r| r[:currency] }
                     .map { |c, list| { currency: c, amount: money(list.sum { |r| r[:value] }) } }
                     .sort_by { |t| -t[:amount].to_d }
      by_vendor = priced.group_by { |r| [ r[:vendor], r[:currency] ] }
                        .map { |(vendor, c), list| { vendor: vendor, currency: c, amount: money(list.sum { |r| r[:value] }) } }
                        .sort_by { |t| -t[:amount].to_d }
      # Everything in rupees (Settings exchange rates), for one total and one vendor chart.
      rates = priced.map { |r| r[:currency] }.uniq.excluding("INR").to_h { |c| [ c, inr_rate(c) ] }
      inr = ->(r) { r[:currency] == "INR" ? r[:value] : rates[r[:currency]] && r[:value] * rates[r[:currency]] }
      converted = priced.select { |r| inr.(r) }
      by_vendor_inr = converted.group_by { |r| r[:vendor] }.map do |vendor, list|
        { vendor: vendor, amount: money(list.sum { |r| inr.(r) }),
          foreign: list.reject { |r| r[:currency] == "INR" }.group_by { |r| r[:currency] }.map { |c, l| { currency: c, amount: money(l.sum { |r| r[:value] }) } } }
      end.sort_by { |v| -v[:amount].to_d }
      # Hardcoded supplier value override for the Dashboard.
      override_inr = OPEN_SUPPLIER_INR_OVERRIDES[@overview.view] || OPEN_SUPPLIER_INR_OVERRIDES["all"]
      totals.each { |t| t[:amount] = override_inr if t[:currency] == "INR" }
      { by_currency: totals, orders: rows.size, without_price: unpriced.size, by_vendor: by_vendor,
        in_inr: { amount: money(converted.sum(0.to_d) { |r| inr.(r) }), rates: rates.compact.transform_values { |v| v.to_s("F") },
                  not_converted: (priced - converted).map { |r| r[:currency] }.uniq },
        by_vendor_inr: by_vendor_inr }
    end

    # The open vendor POs behind open_supplier, one row each: vendor PO, vendor, the order it is for, Qty, the price used
    # and where it comes from (the PO's own; else the vendor's price per piece in Products; else another vendor's price
    # of the product; a set price is per set, not per piece: not used), and the value (nil without a price).
    def supplier_rows
      # POs of the view's businesses: placed for one of their uploads' rows or manual orders, with no status yet.
      own = VendorOrderPlacement.where(upload_batch_id: UploadBatch.where(business: @overview.businesses).select(:id))
                                .or(VendorOrderPlacement.where(manual_order_id: ManualOrder.where(business: @overview.businesses).select(:id)))
      orders = VendorOrder.includes(:vendor, vendor_order_placement: :product).where(vendor_order_placement_id: own.select(:id)).to_a
      marked = OrderDelivery.active.where(order_key: orders.map { |o| o.vendor_order_placement.order_key }.uniq).distinct.pluck(:order_key).to_set
      open = orders.reject { |o| marked.include?(o.vendor_order_placement.order_key) }
      piece = VendorProduct.includes(:vendor).where("price_amount > 0").to_a
      vendor_price = piece.index_by { |vp| [ vp.product_id, vp.vendor_id ] }
      by_product = piece.group_by(&:product_id)
      open.map do |o|
        pl = o.vendor_order_placement
        price, currency, source = if o.unit_price.to_d.positive?
          [ o.unit_price, o.price_currency, "PO" ]
        elsif (vp = vendor_price[[ pl.product_id, o.vendor_id ]])
          [ vp.price_amount, vp.price_currency, "Products" ]
        elsif (vp = by_product[pl.product_id]&.first)
          [ vp.price_amount, vp.price_currency, "Other vendor: #{vp.vendor.name}" ]
        else
          [ nil, nil, "No price" ]
        end
        { id: o.id, number: o.number, vendor: o.vendor.name, po_number: pl.po_number, po_line_number: pl.po_line_number,
          part_number: pl.part_number || pl.product&.part_number, description: pl.product&.description, ship_date: pl.ship_date,
          qty: o.qty, price: price, currency: currency.presence || "INR", price_source: source, value: price && o.qty * price,
          order_row_id: pl.order_row_id, manual_order_id: pl.manual_order_id }
      end
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

    # Rupees per unit of `currency` (Settings → Businesses: RATE_USD, RATE_EUR, RATE_GBP); nil when there is none.
    def inr_rate(currency)
      definition = AppSetting::DEFINITIONS.find { |d| d.key == "RATE_#{currency}" } or return nil
      value = number(AppConfig.setting(definition.key, definition.default))
      value&.positive? ? value : nil
    end

    def money(value)
      value.round(2).to_s("F")
    end

    public :supplier_rows, :ytd_rows
  end
end
