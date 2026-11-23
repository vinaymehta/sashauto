require "bigdecimal"

module Dashboard
  # Operations figures of the dashboard, from the current order data (the latest upload and active manual orders),
  # a combined order (Orders::Combiner) as one order valued at all of its rows. Counts are rows of the order file (as in
  # the file): a combined order of 3 rows counts 3.
  # Open = a Firm or Order order not yet delivered to Deere (no active outbound mark, nor delivered in full on SASH Inc
  # invoices). Values are Qty × Unit Price ÷ 100 (in the business's currency, Settings), as in Dashboard::Money.
  #
  #   kpis       open orders, due in the next 30 days, overdue (ship date passed and not dispatched yet: still with SASH
  #              India or the vendor; dispatched ones are in transit), PO coverage (share of the open value
  #              with a vendor PO generated)
  #   pipeline   open orders by their furthest status: none, received, dispatched (a mark, or on SASH India invoices), inbound
  #   ageing     open orders by age group (days since the Firm Date, Ageing::Rules)
  #   outlook    by ship date from the start of this month: Firm + Order value and Forecast value (the graph groups it)
  #   top_parts  the eight parts with the most open value, each with its product (id, MOQ, customer price) and its open
  #              orders (for the part's detail panel)
  #   upcoming   the next open orders to ship (overdue first), with their status and whether a PO exists
  class Overview
    attr_reader :view

    TYPES = %w[Firm Order].freeze
    STATUSES = %w[none received dispatch dispatched inbound delivery outbound].freeze
    PIPELINE_STATUSES = %w[none received dispatched inbound delivery].freeze
    # Statuses of an order not dispatched from SASH Faridabad yet (nil: no mark and not on SASH India invoices).
    NOT_DISPATCHED = [ nil, "received" ].freeze
    # Statuses of a row dispatched in full or further (OrdersController::MADE_STATUSES): no vendor PO is needed.
    MADE = %w[dispatched inbound delivery outbound].freeze
    # One listed order: its anchor row (or manual order), every row's value summed, and the keys of its marks.
    # unpriced: a row of it has no Unit Price (nor a customer price), so its value leaves that row out. rows: its rows of the
    # order file (1 unless combined).
    # members: [row key, value, Qty, open] of each row (a combined order's in it; a manual order's own); open: whether
    # Deere still lists Qty open on it (a kept row and a row at Qty 0 are not), as the Sale card's list counts lines.
    Order = Data.define(:id, :manual, :key, :firm_key, :po_number, :po_line_number, :part_number, :order_type, :ship_date, :qty, :value, :unpriced,
                        :rows, :members)

    def self.call(today: Time.find_zone!(AppConfig.ageing_time_zone).today, view: "all")
      new(today, view).call
    end

    # `view`: the business view (Business: "dtp", "gmbh" or "all", both businesses together).
    def initialize(today, view = "all")
      @today = today
      @view = view
    end

    # The currency of the view's Deere prices, or nil when the businesses of "all" use different ones.
    def currency
      currencies = Business.of(@view).map { |b| Business.currency(b) }.uniq
      currencies.one? ? currencies.first : nil
    end

    def call
      orders = listed_orders
      status = statuses
      open = open_orders
      placed = VendorOrderPlacement.where(order_key: open.map(&:key)).distinct.pluck(:order_key).to_set
      @order_placed = VendorOrderPlacement.order_placed_keys(placed.to_a)
      {
        kpis: kpis(open, placed),
        pipeline: pipeline(open),
        ageing: ageing(open),
        outlook: outlook(orders),
        top_parts: top_parts(open, status, placed),
        upcoming: upcoming(current(open), status, placed)
      }
    end

    # Firm / Order orders not yet delivered to Deere, as the Orders list shows them (also used by Dashboard::Money):
    # each row by its own status (#row_status), so a combined order keeps only its rows not delivered in full (its
    # rows, Qty and value are theirs).
    def open_orders
      @open_orders ||= listed_orders.select { |o| TYPES.include?(o.order_type) }.filter_map do |o|
        only(o) { |key, qty| row_status(o, key, qty) != "outbound" }
      end
    end

    # A row's status as the Orders list shows it: its order's furthest status mark (a combined order's, unless the row
    # shipped nothing of it: #list_lines), or further its own uploaded invoices (Invoices::Progress, by its own Qty).
    # A row Deere's latest file still lists with Qty open is not delivered in full: its invoices make it Partial
    # outbound (delivery), not Outbound (as OrdersController#invoice_info). GMBH's deliveries come from Deere's receipts
    # (Orders::CurrentLines.receipt_statuses), as the Orders list shows them.
    def row_status(order, key, qty)
      listed, named = list_lines
      # A combined order's row the dispatched orders list does not name has sent nothing: of the combined order's marks
      # only a Received set by hand is its own (as OrdersController#mark_status_sql).
      mark = if order.rows > 1 && listed.include?(order.key) && !named.include?(key)
        "received" if hand_received.include?(order.key)
      else
        marks[order.key]
      end
      own = row_progress[key]&.status(qty)
      own = "delivery" if own == "outbound" && deere_open?(order, qty)
      own = "outbound" if own == "delivery" && deere_closed?(order, qty)
      [ mark, own, (receipt_statuses[key] unless order.manual) ].compact.max_by { |k| STATUSES.index(k) || 0 }
    end

    # Own order key => status from Deere's receipts (GMBH: Orders::CurrentLines.receipt_statuses), once.
    def receipt_statuses
      @receipt_statuses ||= Orders::CurrentLines.receipt_statuses
    end

    # Order keys with an active Received mark set by hand (not by the dispatched orders list), once.
    def hand_received
      @hand_received ||= OrderDelivery.active.where(kind: "received")
                                      .where.not("note LIKE ?", "#{Api::OrdersController::LIST_RECEIVED_NOTE}%").or(OrderDelivery.active.where(kind: "received", note: nil))
                                      .distinct.pluck(:order_key).to_set
    end

    # Whether a row of `order` is still open in Deere's latest file (Qty above 0; not a manual order nor a kept row).
    def deere_open?(order, qty)
      !order.manual && !@kept_ids.include?(order.id) && qty.to_d.positive?
    end

    # Whether a row of `order` is in Deere's latest file with Qty 0: delivered on it is all Deere wants there, so its
    # invoices make it Outbound (as OrdersController#invoice_info).
    def deere_closed?(order, qty)
      !order.manual && !@kept_ids.include?(order.id) && qty.to_d.zero?
    end

    # The order with only its rows for which the block is true (rows, Qty and value theirs); nil when none is.
    def only(order, &keep)
      rows = order.members.select { |key, _, qty| keep.(key, qty) }
      return nil if rows.empty?
      return order if rows.size == order.members.size

      order.with(rows: rows.size, members: rows, qty: rows.sum(BigDecimal("0")) { |m| m[2] }, value: rows.sum(BigDecimal("0")) { |m| m[1] })
    end

    # The orders of Deere's latest files and manual orders: without the rows kept from earlier files, which the Orders
    # list's Ship timing filter (Past ship date, Shipping in next 30 days) leaves out too.
    def current(orders)
      listed_orders
      orders.reject { |o| !o.manual && @kept_ids.include?(o.id) }
    end

    # Row key => its uploaded invoices (Invoices::Progress), for every row of the Firm / Order orders listed.
    def row_progress
      @row_progress ||= Invoices::Progress.for_keys(listed_orders.select { |o| TYPES.include?(o.order_type) }.flat_map { |o| o.members.map(&:first) })
    end

    # order key of each row inside a combined order of the latest upload => the key of its combined order's first row.
    def anchor_keys
      listed_orders
      @anchor_keys
    end

    # The view's businesses (Business::KEYS).
    def businesses
      Business.of(@view)
    end

    # Every order of the current data (the latest uploads, the rows kept from earlier ones as on the Orders page:
    # OrderRow.kept, and manual orders), combined orders folded into their first order.
    def listed_orders
      @listed_orders ||= build_listed_orders
    end

    private

    def build_listed_orders
      @anchor_keys = {}
      @kept_ids = Set.new
      batch_ids = UploadBatch.latest_for(@view).map(&:id)
      return manual_orders if batch_ids.empty?

      combined = Orders::Combiner.for_batches(batch_ids)
      anchor_of = combined.groups.values.select(&:combined?).flat_map { |g| g.members.map { |m| [ m.id, g.anchor_id ] } }.to_h
      kept = OrderRow.kept(batch_ids, businesses).pluck(:id)
      @kept_ids = kept.to_set
      rows = OrderRow.where(upload_batch_id: batch_ids).or(OrderRow.where(id: kept))
                     .pluck(:id, :group_key, :po_number, :po_line_number, :part_number, :order_type, :ship_date, :qty, Arel.sql("source_data->>'Unit Price'"), :upload_batch_id)
      # Orders the Dashboard leaves out (Business.dashboard_excluded?: GMBH's 45… POs).
      business_of = UploadBatch.where(id: rows.map(&:last).uniq).pluck(:id, :business).to_h
      rows.reject! { |r| Business.dashboard_excluded?(business_of[r[9]], r[2], r[4]) }
      prices = price_lookup(rows.map { |r| r[4] })
      charges = Product.charge_parts(rows.map { |r| r[4] })
      row_key = ->(r) { Digest::SHA256.hexdigest([ r[1], r[3], r[6].iso8601 ].join(OrderRows::Normalizer::KEY_SEPARATOR)) }
      # Values are what Deere still has open (its latest files' Qty, as Pending as per DTP): a kept row is listed (and
      # counted) for its shipments, but Deere no longer lists it, so nothing of it is open in value. Priced by the price
      # model of Admin Settings (Orders::DeerePrices).
      values = rows.to_h do |r|
        price = deere_prices.price(business: business_of[r[9]], po_number: r[2], part_number: r[4], order_key: row_key.(r), unit: r[8])
        [ r[0], @kept_ids.include?(r[0]) ? BigDecimal("0") : value(r[7], price, prices[r[4]], charge: charges.include?(r[4])) ]
      end
      groups = rows.group_by { |r| anchor_of[r[0]] || r[0] }
      groups.map do |anchor_id, members|
        row = members.find { |r| r[0] == anchor_id }
        key = row_key.(row)
        members.each { |m| @anchor_keys[row_key.(m)] = key } if members.size > 1
        Order.new(id: anchor_id, manual: false, key: key, firm_key: members.size > 1 ? Orders::FirmDates.combined_key(key) : key,
                  po_number: row[2], po_line_number: row[3], part_number: row[4], order_type: row[5],
                  ship_date: members.map { |m| m[6] }.max, # a combined order ships with its last order
                  qty: members.sum { |m| m[7].to_d }, value: members.filter_map { |m| values[m[0]] }.sum(BigDecimal("0")),
                  unpriced: members.any? { |m| values[m[0]].nil? }, rows: members.size,
                  members: members.map { |m| [ row_key.(m), values[m[0]] || BigDecimal("0"), m[7].to_d, !@kept_ids.include?(m[0]) && m[7].to_d.positive? ] })
      end + manual_orders
    end

    def manual_orders
      list = ManualOrder.active.where(business: Business.of(@view)).where.not(Business.dashboard_excluded_sql("manual_orders.business", "manual_orders.po_number", "manual_orders.part_number"))
                        .pluck(:id, :po_number, :po_line_number, :part_number, :order_type, :ship_date, :qty, Arel.sql("source_data->>'Unit Price'"), :business)
      prices = price_lookup(list.map { |m| m[3] })
      charges = Product.charge_parts(list.map { |m| m[3] })
      list.map do |id, po, line, part, type, ship, qty, unit, business|
        key = VendorOrderPlacement.order_key(ManualOrder.new(id: id))
        price = deere_prices.price(business: business, po_number: po, part_number: part, order_key: nil, unit: unit)
        amount = value(qty, price, prices[part], charge: charges.include?(part))
        Order.new(id: id, manual: true, key: key, firm_key: key, po_number: po, po_line_number: line, part_number: part, order_type: type,
                  ship_date: ship, qty: qty.to_d, value: amount || BigDecimal("0"), unpriced: amount.nil?, rows: 1,
                  members: [ [ key, amount || BigDecimal("0"), qty.to_d, qty.to_d.positive? ] ])
      end
    end

    # order key => furthest status, for the Firm / Order orders listed: its furthest active status mark, or further its
    # uploaded invoices' (see #invoice_statuses). An order with a row Deere still lists open is Partial outbound at most
    # by its invoices (#deere_open?); one whose rows are all Outbound by their own (#row_status, #deere_closed?) is Outbound.
    # Deere's receipts (GMBH, #receipt_statuses) count as its invoices: Outbound when every row is, else Partial outbound.
    def statuses
      @statuses ||= begin
        orders = listed_orders.select { |o| TYPES.include?(o.order_type) }.index_by(&:key)
        open = orders.values.select { |o| o.members.any? { |_, _, qty| deere_open?(o, qty) } }.to_set(&:key)
        invoices = invoice_statuses(orders.keys).to_h do |key, s|
          o = orders[key]
          s = "delivery" if s == "outbound" && open.include?(key)
          s = "outbound" if s == "delivery" && o && o.members.all? { |k, _, qty| row_status(o, k, qty) == "outbound" }
          [ key, s ]
        end
        received = orders.values.select { |o| !o.manual && o.members.any? { |k, *| receipt_statuses.key?(k) } }.to_h do |o|
          [ o.key, o.members.all? { |k, _, qty| row_status(o, k, qty) == "outbound" } ? "outbound" : "delivery" ]
        end
        further = ->(_, a, b) { [ a, b ].max_by { |k| STATUSES.index(k) || 0 } }
        marks.merge(invoices, &further).merge(received, &further)
      end
    end

    # order key => furthest active status mark, for the Firm / Order orders listed (a combined order's on its first row).
    def marks
      @marks ||= begin
        kinds = OrderDelivery::KINDS
        keys = listed_orders.select { |o| TYPES.include?(o.order_type) }.map(&:key)
        OrderDelivery.active.where(order_key: keys).pluck(:order_key, :kind).group_by(&:first)
                     .transform_values { |list| list.map(&:last).max_by { |k| kinds.index(k) } }
      end
    end

    # [row key, value] of the rows of the open orders past their ship date (a combined order's by its last ship date)
    # that are not dispatched yet, each row by its own status: its order's mark, or its own SASH India invoices (a
    # combined order may be dispatched in part). As the Orders list shows them (Past ship date, status none / received).
    # A row of a combined order that no dispatched orders list line names, while its combined order's Dispatched mark
    # came from such a list, has shipped nothing: its combined order's mark is not its own (as the Orders list,
    # OrdersController#not_sent_ids). Only rows still waiting to be dispatched (Orders::CurrentLines.undispatched_keys:
    # Qty open at Deere, nothing sent for them, also not on an earlier ship date of their PO line; not a charge), as the
    # Past ship date list (Orders list `late=1`).
    def late_rows(open)
      waiting = Orders::CurrentLines.undispatched_keys(businesses)
      late = open.select { |o| o.ship_date < @today }
      progress = Invoices::Progress.for_keys(late.flat_map { |o| o.members.map(&:first) })
      kinds = OrderDelivery::KINDS
      listed, named = list_lines
      late.flat_map do |o|
        o.members.select do |key, _|
          invoice = "dispatched" if progress[key] && (progress[key].shipped.positive? || progress[key].outbound.positive?)
          mark = o.rows > 1 && listed.include?(o.key) && !named.include?(key) ? nil : marks[o.key]
          waiting.include?(key) && NOT_DISPATCHED.include?([ mark, invoice ].compact.max_by { |k| kinds.index(k) })
        end
      end
    end

    # [keys of the orders whose Dispatched mark came from a dispatched orders list, keys of the rows its lines name].
    def list_lines
      @list_lines ||= begin
        marks = OrderDelivery.active.where(kind: "dispatched").where.not(invoice_lines: nil).pluck(:order_key, :invoice_lines)
        [ marks.select { |_, lines| Array(lines).any? }.map(&:first).to_set,
          marks.flat_map { |_, lines| Array(lines).map { |l| l["order_key"] } }.to_set ]
      end
    end

    # order key => status from the uploaded invoices (Invoices::Progress, recorded on each row of a combined order):
    # outbound when every row of the order is delivered in full (by the Qty it was dispatched for), delivery when
    # any row is delivered in part or full (partial outbound), else dispatched when any row was dispatched (in transit).
    def invoice_statuses(keys)
      members = keys.to_h { |key| [ key, [ key ] ] }
      anchor_keys.each { |member, anchor| members[anchor] << member if members.key?(anchor) && member != anchor }
      progress = Invoices::Progress.for_keys(members.values.flatten)
      members.filter_map do |key, list|
        entries = list.map { |k| progress[k] }
        next unless entries.compact.any? { |entry| entry.shipped.positive? || entry.outbound.positive? }

        status = if entries.all? { |entry| entry&.status(nil) == "outbound" }
                   "outbound"
        elsif entries.any? { |entry| %w[delivery outbound].include?(entry&.status(nil)) }
                   "delivery"
        else
                   "dispatched"
        end
        [ key, status ]
      end.to_h
    end

    def kpis(open, placed)
      covered = open.select { |o| placed.include?(o.key) }
      total = open.sum(BigDecimal("0"), &:value)
      firm_order = listed_orders.select { |o| TYPES.include?(o.order_type) }
      {
        open: bucket(open),
        due_30: bucket(current(open).select { |o| o.ship_date >= @today && o.ship_date <= @today + 30 }),
        overdue: late_rows(current(open)).then { |rows| { count: rows.size, value: money(rows.sum(BigDecimal("0")) { |m| m[1] }) } },
        po_coverage: { percent: total.positive? ? (covered.sum(BigDecimal("0"), &:value) / total * 100).round(1).to_f : 0.0,
                       covered: bucket(covered), without_po: bucket(without_po(open, placed)) },
        partial_outbound: bucket(firm_order.select { |o| statuses[o.key] == "delivery" }),
        outbound: bucket(firm_order.select { |o| statuses[o.key] == "outbound" })
      }
    end

    # Open orders with no vendor PO yet, by their rows with a Qty that SASH India has not dispatched (nothing is left to
    # make for a dispatched row), as the Orders list's Vendor PO: No PO yet.
    def without_po(open, placed)
      open.reject { |o| placed.include?(o.key) }.filter_map do |o|
        only(o) { |key, qty| qty.positive? && !MADE.include?(row_status(o, key, qty)) }
      end
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
      products = Product.with_attached_images.where(part_number: top.map(&:first)).index_by(&:part_number)
      top.map do |part, list|
        product = products[part]
        img = product&.images&.first
        { part_number: part, description: product&.description, orders: list.size,
          qty: Serializers.qty(list.sum(BigDecimal("0"), &:qty)), value: money(list.sum(BigDecimal("0"), &:value)),
          product_id: product&.id, moq: Serializers.qty(product && (product.moq_sets || product.moq)),
          customer_price: Serializers.qty(product&.customer_price),
          image_url: img ? "/api/products/#{product.id}/images/#{img.id}" : nil,
          images: product ? Serializers.product_images(product) : [],
          open_orders: list.sort_by { |o| [ o.ship_date, o.po_number ] }.map { |o| order_json(o, status, placed, products) } }
      end
    end

    def upcoming(open, status, placed)
      orders = open.select { |o| o.ship_date <= @today + 30 && o.qty.positive? }.sort_by { |o| [ o.ship_date, o.po_number ] }.first(8)
      products = Product.with_attached_images.where(part_number: orders.map(&:part_number).uniq).index_by(&:part_number)
      orders.map { |o| order_json(o, status, placed, products) }
    end

    def order_json(order, status, placed, products = {})
      prod = products[order.part_number]
      img = prod&.images&.first
      { id: order.id, manual: order.manual, po_number: order.po_number, po_line_number: order.po_line_number,
        part_number: order.part_number, order_type: order.order_type, ship_date: order.ship_date, qty: Serializers.qty(order.qty),
        value: money(order.value), status: status[order.key] || "none", po: placed.include?(order.key),
        order_placed: @order_placed.include?(order.key), overdue: order.ship_date < @today,
        product_id: prod&.id,
        image_url: img ? "/api/products/#{prod.id}/images/#{img.id}" : nil,
        images: prod ? Serializers.product_images(prod) : [] }
    end

    # Open orders by status, row by row as the Orders list's Status filter counts them (#row_status: a combined order's
    # rows each by their own; part dispatched counts as Dispatched), so a step and the list it opens agree.
    def pipeline(open)
      steps = PIPELINE_STATUSES.index_with { [] }
      open.each do |o|
        o.members.each do |key, value, qty|
          s = row_status(o, key, qty) || "none"
          s = "dispatched" if s == "dispatch"
          (steps[s] ||= []) << value
        end
      end
      PIPELINE_STATUSES.map { |s| { count: steps[s].size, value: money(steps[s].sum(BigDecimal("0"))), status: s } }
    end

    def bucket(list)
      { count: list.sum(&:rows), value: money(list.sum(BigDecimal("0"), &:value)) }
    end

    # Qty × price per 100 pcs ÷ 100: `price` (Orders::DeerePrices), else the part's customer price; nil without either.
    # (A charge's Unit Price is the charge itself: Qty × price.)
    def value(qty, price, fallback, charge: false)
      price ||= fallback
      price && qty.to_d * price / (charge ? 1 : 100)
    end

    # Deere's prices under the price model of Admin Settings, once per overview.
    def deere_prices
      @deere_prices ||= Orders::DeerePrices.new
    end

    def price_lookup(parts)
      Product.where(part_number: parts.uniq).pluck(:part_number, :customer_price).to_h
    end

    def money(value)
      value.round(2).to_s("F")
    end
  end
end
