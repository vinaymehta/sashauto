require "bigdecimal"

module Dashboard
  # Money figures of the dashboard, each with the series for its graph. Orders are counted as the Orders page lists
  # them (Dashboard::Overview): a combined order once, at the total of its rows and on its last row's ship date.
  # - open_sale: Deere orders still to deliver: the open orders of Dashboard::Overview (Firm and Order rows not
  #   delivered to Deere, as the Orders list shows them), `orders` counting their rows as the list does. Value = Qty ×
  #   Unit Price ÷ 100 (Deere prices per 100 pcs; in the business's currency, Settings). by_date: value per ship date
  #   (the graph groups it by week or month).
  # - open_supplier: what vendors still owe: each vendor PO's Qty not yet received at SASH (PO Qty − goods received) ×
  #   the vendor's unit price, per currency and in rupees (Settings exchange rates); a PO without a price is counted in
  #   without_price (value unknown). by_vendor: value per vendor and currency.
  # - ytd_customer_spend: goods delivered to Deere from the start of the financial year (1 April) to today (#deliveries):
  #   DTP on SASH Inc invoices (by invoice date, at the invoice's price), GMBH by Deere's Cumulative Receipt Qty (by the day it rose in Deere's
  #   daily file). Freight is left out, as in the Fulfilment's Delivered to Deere. by_date: value per delivery day from
  #   series_from (the earlier of the financial year start and six months ago) to today, for the graph's Month /
  #   6 months / Year views.
  # The Unit Price is Deere's under the price model of Admin Settings (Orders::DeerePrices: the price the order came
  # with, or its latest price), else the order's own (file column "Unit Price"), else the part's customer price (Products).
  class Money
    TYPES = %w[Firm Order].freeze

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

    # One rupee total of supplier rows in several currencies (Settings exchange rates), as Total Open Value (Supplier)
    # shows it: { amount, rates (currency => rupees), not_converted (currencies without a rate, left out) }.
    def inr_total(rows)
      priced = rows.select { |r| r[:value] }
      rates = priced.map { |r| r[:currency] }.uniq.excluding("INR").to_h { |c| [ c, inr_rate(c) ] }
      inr = ->(r) { r[:currency] == "INR" ? r[:value] : rates[r[:currency]] && r[:value] * rates[r[:currency]] }
      converted = priced.select { |r| inr.(r) }
      { amount: money(converted.sum(0.to_d) { |r| inr.(r) }), rates: rates.compact.transform_values { |v| v.to_s("F") },
        not_converted: (priced - converted).map { |r| r[:currency] }.uniq }
    end

    private

    # Counted in order lines Deere still lists open (Qty above 0; not a kept row), as the card's list (Pending as per DTP).
    def open_sale
      open = @overview.open_orders
      lines = ->(list) { list.sum { |o| o.members.count { |m| m[3] } } }
      totals(open.map { |o| [ o.ship_date, o.value, o.unpriced ] })
        .merge(orders: lines.(open), without_price: lines.(open.select(&:unpriced)))
    end

    def ytd_customer_spend
      from, deliveries = ytd_deliveries
      ytd = deliveries.select { |d| d[:date] >= from }
      totals(ytd.map { |d| [ d[:date], d[:value], d[:value].nil? ] })
        .merge(from: from, to: @today, series_from: from_series(from), by_date: by_date(deliveries.map { |d| [ d[:date], d[:value], d[:value].nil? ] }))
    end

    # The deliveries behind ytd_customer_spend (1 April to today), one row each: the order (or PO line) delivered, Qty,
    # Unit Price (per 100 pcs), value, and the invoice or Deere file it is from.
    def ytd_rows
      from, deliveries = ytd_deliveries
      deliveries.select { |d| d[:date] >= from }.map { |d| d[:row] }
    end

    def from_series(from)
      [ from, (@today << 5).beginning_of_month ].min
    end

    # [1 April of the financial year, the deliveries to Deere from the series start to today: { date, value, row }]
    # (#deliveries).
    def ytd_deliveries
      @ytd_deliveries ||= begin
        from = @today.month >= 4 ? Date.new(@today.year, 4, 1) : Date.new(@today.year - 1, 4, 1)
        [ from, deliveries(from_series(from)) ]
      end
    end

    # Goods delivered to Deere from `since` to today, as Delivered to Deere counts them (OrdersController#summary_lines):
    # - the businesses with SASH Inc invoices (DTP): each invoice line's Qty on the order it delivered, on the invoice's
    #   date, at the invoice line's price (what SASH Inc billed; Deere's price of that order when the line has none);
    # - the businesses whose deliveries are Deere's receipts (GMBH): each rise of a PO line's Cumulative Receipt Qty in
    #   Deere's daily files (#receipt_rises), on that file's day, at Deere's price of the PO + Part (under price by order
    #   date: the price in that file, as a receipt is not one order).
    # Orders the Dashboard leaves out (Business.dashboard_excluded?) and freight (charges) are not counted.
    def deliveries(since)
      prices = Orders::DeerePrices.new
      receipt_businesses = @overview.businesses & Orders::LineFigures::RECEIPT_BUSINESSES
      list = invoice_deliveries(since, @overview.businesses - receipt_businesses, prices) +
             receipt_businesses.flat_map { |b| receipt_deliveries(b, since, prices) }
      fallback = Product.where(part_number: list.map { |d| d[:part] }.uniq).pluck(:part_number, :customer_price).to_h
      charges = Product.charge_parts(list.map { |d| d[:part] }.uniq)
      descriptions = Product.where(part_number: list.map { |d| d[:part] }.uniq).pluck(:part_number, :description).to_h
      list.filter_map do |d|
        next if charges.include?(d[:part]) || Business.dashboard_excluded?(d[:business], d[:po_number], d[:part])

        price = d[:price] || fallback[d[:part]]
        value = price && d[:qty] * price / 100
        { date: d[:date], value: value,
          row: { id: d[:id], manual: d[:manual], business: d[:business], po_number: d[:po_number], po_line_number: d[:po_line_number],
                 order_type: d[:order_type], part_number: d[:part], description: descriptions[d[:part]], ship_date: d[:date],
                 qty: d[:qty], price: price, value: value, file: d[:file], file_name: d[:file_name] } }
      end
    end

    # SASH Inc invoice deliveries (see #deliveries) of `businesses`, before the price fallback.
    def invoice_deliveries(since, businesses, prices)
      return [] if businesses.empty?

      allocations = InvoiceAllocation.active.where(invoices: { kind: "inc", business: businesses, invoice_date: since..@today })
                                     .pluck(:order_key, :order_row_id, :manual_order_id, :po_number, :po_line_number, :part_number, :order_type, :qty,
                                            "invoices.business", "invoices.invoice_number", "invoices.invoice_date", "invoices.original_filename",
                                            Arel.sql("invoices.lines -> invoice_allocations.line_index ->> 'price'"))
      units = OrderRow.where(id: allocations.map { |a| a[1] }.compact.uniq).pluck(:id, Arel.sql("source_data->>'Unit Price'")).to_h
      manual_units = ManualOrder.where(id: allocations.map { |a| a[2] }.compact.uniq).pluck(:id, Arel.sql("source_data->>'Unit Price'")).to_h
      allocations.map do |key, row_id, manual_id, po, line, part, type, qty, business, invoice_no, date, filename, billed|
        unit = manual_id ? manual_units[manual_id] : units[row_id]
        # Customer spend is what SASH Inc billed: the invoice line's price per piece (as a price per 100 pcs, like
        # Deere's); Deere's price only when the line has none.
        billed = number(billed)
        { business: business, date: date, id: manual_id || row_id, manual: manual_id.present?, po_number: po, po_line_number: line,
          order_type: type, part: part, qty: qty.to_d, file: "SASH Inc #{invoice_no} · #{date.strftime('%d %b %Y')}", file_name: filename,
          price: billed&.positive? ? billed * 100 : prices.price(business: business, po_number: po, part_number: part, order_key: manual_id ? nil : key, unit: unit) }
      end
    end

    # Deere receipt deliveries (see #deliveries) of one business, before the price fallback.
    def receipt_deliveries(business, since, prices)
      receipt_rises(business).filter_map do |date, po, part, line, qty, unit, filename|
        next if date < since || date > @today

        { business: business, date: date, id: nil, manual: false, po_number: po, po_line_number: line, order_type: nil, part: part,
          qty: qty, file: "Deere receipt · #{date.strftime('%d %b %Y')}", file_name: filename,
          price: prices.price(business: business, po_number: po, part_number: part, order_key: nil, unit: unit) }
      end
    end

    # Each rise of a PO line's Cumulative Receipt Qty in the business's Deere files, oldest first: [file day, PO, Part, PO
    # Line, Qty received, the PO line's Unit Price in that file, file name]. The first file is where counting starts (what
    # it lists was received before); a PO line that first appears later with Qty received counts it on that day. Uploads
    # never change once completed, so this is cached until the next upload.
    def receipt_rises(business)
      batches = UploadBatch.where(business: business, status: "completed").order(:completed_at, :id).pluck(:id, :completed_at, :original_filename)
      return [] if batches.empty?

      Rails.cache.fetch([ "dashboard/receipt_rises/v1", business, batches.last.first, batches.size ]) do
        zone = Time.find_zone!(AppConfig.ageing_time_zone)
        rows = OrderRow.where(upload_batch_id: batches.map(&:first))
                       .pluck(:upload_batch_id, :po_number, :part_number, :po_line_number,
                              Arel.sql("source_data->>'Cumulative Receipt Qty'"), Arel.sql("source_data->>'Unit Price'")).group_by(&:first)
        last = {}
        batches.each_with_index.flat_map do |(id, at, filename), i|
          now = {}
          (rows[id] || []).each do |_, po, part, line, received, unit|
            key = [ po, part, line ]
            qty = number(received) || 0.to_d
            now[key] = [ [ now[key]&.first || 0.to_d, qty ].max, now[key]&.last || unit ]
          end
          rises = i.zero? ? [] : now.filter_map do |(po, part, line), (qty, unit)|
            rise = qty - (last[[ po, part, line ]] || 0.to_d)
            [ at.in_time_zone(zone).to_date, po, part, line, rise, unit, filename ] if rise.positive?
          end
          now.each { |key, (qty, _)| last[key] = [ last[key] || 0.to_d, qty ].max }
          rises
        end
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
        { vendor: vendor, vendor_id: list.first[:vendor_id], amount: money(list.sum { |r| inr.(r) }),
          foreign: list.reject { |r| r[:currency] == "INR" }.group_by { |r| r[:currency] }.map { |c, l| { currency: c, amount: money(l.sum { |r| r[:value] }) } } }
      end.sort_by { |v| -v[:amount].to_d }
      { by_currency: totals, orders: rows.size, without_price: unpriced.size, by_vendor: by_vendor,
        in_inr: inr_total(priced), by_vendor_inr: by_vendor_inr }
    end

    # The open vendor POs behind open_supplier, one row each: vendor PO, vendor, the order it is for, the Qty the vendor
    # still owes (PO Qty − goods received, VendorOrderReceipt), the price used and where it comes from (the PO's own;
    # else the vendor's price per piece in Products; else another vendor's price of the product; a set price is per set,
    # not per piece: not used), and the value of what is still owed (nil without a price: unknown, not 0). Whatever the
    # Deere order's status: a vendor owes its goods until SASH receives them. Orders the Dashboard leaves out
    # (Business.dashboard_excluded?: GMBH's 45… POs, excluded parts) are left out here too.
    def supplier_rows
      own = VendorOrderPlacement.where(upload_batch_id: UploadBatch.where(business: @overview.businesses).select(:id))
                                .or(VendorOrderPlacement.where(manual_order_id: ManualOrder.where(business: @overview.businesses).select(:id)))
      orders = VendorOrder.includes(:vendor, vendor_order_placement: :product).where(vendor_order_placement_id: own.select(:id)).to_a
      received = VendorOrderReceipt.where(vendor_order_id: orders.map(&:id)).group(:vendor_order_id).sum(:qty)
      batch_business = UploadBatch.where(id: orders.map { |o| o.vendor_order_placement.upload_batch_id }.compact.uniq).pluck(:id, :business).to_h
      manual_business = ManualOrder.where(id: orders.map { |o| o.vendor_order_placement.manual_order_id }.compact.uniq).pluck(:id, :business).to_h
      open = orders.filter_map do |o|
        pl = o.vendor_order_placement
        business = pl.manual_order_id ? manual_business[pl.manual_order_id] : batch_business[pl.upload_batch_id]
        next if Business.dashboard_excluded?(business, pl.po_number, pl.part_number || pl.product&.part_number)

        owed = [ o.qty.to_d - received[o.id].to_d, 0.to_d ].max
        [ o, owed ] if owed.positive?
      end
      piece = VendorProduct.includes(:vendor).where("price_amount > 0").to_a
      vendor_price = piece.index_by { |vp| [ vp.product_id, vp.vendor_id ] }
      by_product = piece.group_by(&:product_id)
      open.map do |o, owed|
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
        { id: o.id, number: o.number, vendor: o.vendor.name, vendor_id: o.vendor_id, po_number: pl.po_number, po_line_number: pl.po_line_number,
          part_number: pl.part_number || pl.product&.part_number, description: pl.product&.description, ship_date: pl.ship_date,
          qty: owed, po_qty: o.qty, received_qty: received[o.id].to_d, price: price, currency: currency.presence || "INR", price_source: source,
          value: price && owed * price, order_row_id: pl.order_row_id, manual_order_id: pl.manual_order_id,
          file: file_label(pl.upload_batch_id, manual: pl.manual_order_id.present?) }
      end
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

    # File of an order (the Dashboard lists' File column): "Latest" for Deere's latest file of its business, "Old file ·
    # day" for an older upload, "Manual order" for a manual one.
    def file_label(batch_id, manual: false)
      return "Manual order" if manual || batch_id.nil?

      @latest_batch_ids ||= UploadBatch.latest_for("all").map(&:id).to_set
      return "Latest" if @latest_batch_ids.include?(batch_id)

      @batch_days ||= {}
      @batch_days[batch_id] ||= UploadBatch.find_by(id: batch_id)&.completed_at&.in_time_zone(AppConfig.ageing_time_zone)&.to_date
      "Old file#{@batch_days[batch_id] ? " · #{@batch_days[batch_id].strftime('%d %b %Y')}" : ''}"
    end

    def money(value)
      value.round(2).to_s("F")
    end

    public :supplier_rows, :ytd_rows
  end
end
