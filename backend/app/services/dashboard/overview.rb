require "bigdecimal"

module Dashboard
  # Operations figures of the dashboard, from the current order data (the latest upload and active manual orders),
  # counting orders as the Orders page lists them: a combined order (Orders::Combiner) once, valued at all of its rows.
  # Open = a Firm or Order order not yet delivered to Deere (no active outbound mark). Values are Qty × Unit Price ÷ 100
  # (USD), as in Dashboard::Money.
  #
  #   kpis       open orders, due in the next 30 days, overdue (ship date passed), PO coverage (share of the open value
  #              with a vendor PO generated)
  #   pipeline   open orders by their furthest status mark: none, received, dispatched, inbound
  #   ageing     open orders by age group (days since the Firm Date, Ageing::Rules)
  #   outlook    by ship date from the start of this month: Firm + Order value and Forecast value (the graph groups it)
  #   top_parts  the eight parts with the most open value, each with its product (id, MOQ, customer price) and its open
  #              orders (for the part's detail panel)
  #   upcoming   the next open orders to ship (overdue first), with their status and whether a PO exists
  class Overview
    TYPES = %w[Firm Order].freeze
    STATUSES = %w[none received dispatched inbound].freeze
    # One listed order: its anchor row (or manual order), every row's value summed, and the keys of its marks.
    # unpriced: a row of it has no Unit Price (nor a customer price), so its value leaves that row out.
    Order = Data.define(:id, :manual, :key, :firm_key, :po_number, :po_line_number, :part_number, :order_type, :ship_date, :qty, :value, :unpriced)

    def self.call(today: Time.find_zone!(AppConfig.ageing_time_zone).today)
      new(today).call
    end

    def initialize(today)
      @today = today
    end

    def call
      orders = listed_orders
      status = statuses
      open = open_orders
      placed = VendorOrderPlacement.where(order_key: open.map(&:key)).distinct.pluck(:order_key).to_set
      {
        kpis: kpis(open, placed),
        pipeline: STATUSES.map { |s| bucket(open.select { |o| (status[o.key] || "none") == s }).merge(status: s) },
        ageing: ageing(open),
        outlook: outlook(orders),
        top_parts: top_parts(open, status, placed),
        upcoming: upcoming(open, status, placed)
      }
    end

    # Firm / Order orders not yet delivered to Deere, as listed (also used by Dashboard::Money).
    def open_orders
      @open_orders ||= listed_orders.select { |o| TYPES.include?(o.order_type) && statuses[o.key] != "outbound" }
    end

    # order key of each row inside a combined order of the latest upload => the key of its combined order's first row.
    def anchor_keys
      listed_orders
      @anchor_keys
    end

    # Every order of the current data, combined orders folded into their first order.
    def listed_orders
      @listed_orders ||= build_listed_orders
    end

    private

    def build_listed_orders
      @anchor_keys = {}
      batch = UploadBatch.latest_completed
      return manual_orders unless batch

      combined = Orders::Combiner.call(batch.id)
      anchor_of = combined.groups.values.select(&:combined?).flat_map { |g| g.members.map { |m| [ m.id, g.anchor_id ] } }.to_h
      rows = OrderRow.where(upload_batch_id: batch.id)
                     .pluck(:id, :group_key, :po_number, :po_line_number, :part_number, :order_type, :ship_date, :qty, Arel.sql("source_data->>'Unit Price'"))
      prices = price_lookup(rows.map { |r| r[4] })
      values = rows.to_h { |r| [ r[0], value(r[7], r[8], prices[r[4]]) ] }
      groups = rows.group_by { |r| anchor_of[r[0]] || r[0] }
      row_key = ->(r) { Digest::SHA256.hexdigest([ r[1], r[3], r[6].iso8601 ].join(OrderRows::Normalizer::KEY_SEPARATOR)) }
      groups.map do |anchor_id, members|
        row = members.find { |r| r[0] == anchor_id }
        key = row_key.(row)
        members.each { |m| @anchor_keys[row_key.(m)] = key } if members.size > 1
        Order.new(id: anchor_id, manual: false, key: key, firm_key: members.size > 1 ? Orders::FirmDates.combined_key(key) : key,
                  po_number: row[2], po_line_number: row[3], part_number: row[4], order_type: row[5], ship_date: row[6],
                  qty: members.sum { |m| m[7].to_d }, value: members.filter_map { |m| values[m[0]] }.sum(BigDecimal("0")),
                  unpriced: members.any? { |m| values[m[0]].nil? })
      end + manual_orders
    end

    def manual_orders
      list = ManualOrder.active.pluck(:id, :po_number, :po_line_number, :part_number, :order_type, :ship_date, :qty, Arel.sql("source_data->>'Unit Price'"))
      prices = price_lookup(list.map { |m| m[3] })
      list.map do |id, po, line, part, type, ship, qty, price|
        key = VendorOrderPlacement.order_key(ManualOrder.new(id: id))
        amount = value(qty, price, prices[part])
        Order.new(id: id, manual: true, key: key, firm_key: key, po_number: po, po_line_number: line, part_number: part, order_type: type,
                  ship_date: ship, qty: qty.to_d, value: amount || BigDecimal("0"), unpriced: amount.nil?)
      end
    end

    # order key => furthest active status mark, for the Firm / Order orders listed.
    def statuses
      @statuses ||= begin
        kinds = OrderDelivery::KINDS
        keys = listed_orders.select { |o| TYPES.include?(o.order_type) }.map(&:key)
        OrderDelivery.active.where(order_key: keys).pluck(:order_key, :kind).group_by(&:first)
                     .transform_values { |marks| marks.map(&:last).max_by { |k| kinds.index(k) } }
      end
    end

    def kpis(open, placed)
      covered = open.select { |o| placed.include?(o.key) }
      total = open.sum(BigDecimal("0"), &:value)
      {
        open: bucket(open),
        due_30: bucket(open.select { |o| o.ship_date >= @today && o.ship_date <= @today + 30 }),
        overdue: bucket(open.select { |o| o.ship_date < @today }),
        po_coverage: { percent: total.positive? ? (covered.sum(BigDecimal("0"), &:value) / total * 100).round(1).to_f : 0.0,
                       covered: bucket(covered), without_po: bucket(open.reject { |o| placed.include?(o.key) || o.qty.zero? }) }
      }
    end

    def ageing(open)
      dates = Orders::FirmDates.for_keys(open.map(&:firm_key))
      bands = open.group_by { |o| Ageing::Rules.band_for(dates[o.firm_key], @today) || "none" }
      %w[red yellow green none].map { |band| bucket(bands.fetch(band, [])).merge(band: band) }
    end

    def outlook(orders)
      start = @today.beginning_of_month
      orders.select { |o| o.ship_date >= start }.group_by(&:ship_date).sort.map do |date, list|
        firm, forecast = list.partition { |o| TYPES.include?(o.order_type) }
        { date: date, firm: money(firm.sum(BigDecimal("0"), &:value)), forecast: money(forecast.sum(BigDecimal("0"), &:value)) }
      end
    end

    def top_parts(open, status, placed)
      top = open.group_by(&:part_number).sort_by { |_, list| -list.sum(BigDecimal("0"), &:value) }.first(8)
      products = Product.where(part_number: top.map(&:first)).index_by(&:part_number)
      top.map do |part, list|
        product = products[part]
        { part_number: part, description: product&.description, orders: list.size,
          qty: Serializers.qty(list.sum(BigDecimal("0"), &:qty)), value: money(list.sum(BigDecimal("0"), &:value)),
          product_id: product&.id, moq: Serializers.qty(product && (product.moq_sets || product.moq)),
          customer_price: Serializers.qty(product&.customer_price),
          open_orders: list.sort_by { |o| [ o.ship_date, o.po_number ] }.map { |o| order_json(o, status, placed) } }
      end
    end

    def upcoming(open, status, placed)
      open.select { |o| o.ship_date <= @today + 30 && o.qty.positive? }.sort_by { |o| [ o.ship_date, o.po_number ] }.first(8)
          .map { |o| order_json(o, status, placed) }
    end

    def order_json(order, status, placed)
      { id: order.id, manual: order.manual, po_number: order.po_number, po_line_number: order.po_line_number,
        part_number: order.part_number, order_type: order.order_type, ship_date: order.ship_date, qty: Serializers.qty(order.qty),
        value: money(order.value), status: status[order.key] || "none", po: placed.include?(order.key), overdue: order.ship_date < @today }
    end

    def bucket(list)
      { count: list.size, value: money(list.sum(BigDecimal("0"), &:value)) }
    end

    # Qty × price per 100 pcs ÷ 100: the order's own Unit Price, else the part's customer price; nil without either.
    def value(qty, price_text, fallback)
      text = price_text.to_s.delete(",").strip
      price = text.match?(/\A\d+(\.\d+)?\z/) ? BigDecimal(text) : fallback
      price && qty.to_d * price / 100
    end

    def price_lookup(parts)
      Product.where(part_number: parts.uniq).pluck(:part_number, :customer_price).to_h
    end

    def money(value)
      value.round(2).to_s("F")
    end
  end
end
