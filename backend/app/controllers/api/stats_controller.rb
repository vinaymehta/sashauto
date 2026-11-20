module Api
  class StatsController < ApplicationController
    def show
      render json: Dashboard::Stats.call(current_business)
    end

    # The open vendor POs behind the Dashboard's Total Open Value (Supplier), one row each (Dashboard::Money#supplier_rows).
    def supplier_orders
      calc = money
      rows = calc.supplier_rows
      # One vendor's POs (the Dashboard's vendor chart).
      rows = rows.select { |r| r[:vendor_id] == params[:vendor_id].to_i } if params[:vendor_id].present?
      found, page, meta = search_sort_page(rows, search: %i[number vendor part_number description po_number price_source], numeric: %i[qty price value],
                                                 default_sort: "value")
      # Totals of the POs found (all pages): per currency, and in rupees as the card shows them.
      by_currency = found.select { |r| r[:value] }.group_by { |r| r[:currency] }
                         .map { |c, l| { currency: c, amount: l.sum { |r| r[:value] }.round(2).to_s("F") } }.sort_by { |t| -t[:amount].to_d }
      render json: { data: with_images(page.map { |r| r.merge(qty: Serializers.qty(r[:qty]), price: r[:price]&.to_s("F"), value: r[:value]&.round(2)&.to_s("F")) }),
                     meta: meta, totals: { qty: Serializers.qty(found.sum(0.to_d) { |r| r[:qty].to_d }), by_currency: by_currency,
                                           in_inr: calc.inr_total(found) } }
    end

    # The order rows behind the Dashboard's YTD Customer Spend (Dashboard::Money#ytd_rows).
    def ytd_orders
      found, page, meta = search_sort_page(money.ytd_rows, search: %i[part_number description po_number], numeric: %i[qty price value],
                                                 default_sort: "value")
      # Totals of the unrounded values of the rows found, as the card adds them up.
      totals = { qty: Serializers.qty(found.sum(0.to_d) { |r| r[:qty].to_d }), value: found.sum(0.to_d) { |r| r[:value] || 0 }.round(2).to_s("F") }
      render json: { data: with_images(page.map { |r| r.merge(qty: Serializers.qty(r[:qty]), price: r[:price]&.to_s("F"), value: r[:value]&.round(2)&.to_s("F")) }),
                     meta: meta, totals: totals,
                     currency: Dashboard::Overview.new(today, current_business).currency }
    end

    private

    # Rows with their part's photos (thumbnails).
    def with_images(rows)
      images = Serializers.part_images(rows.map { |r| r[:part_number] })
      rows.map { |r| r.merge(images[r[:part_number]] || { image_url: nil, images: [] }) }
    end

    def today
      Time.find_zone!(AppConfig.ageing_time_zone).today
    end

    def money
      Dashboard::Money.new(today, Dashboard::Overview.new(today, current_business))
    end
  end
end
