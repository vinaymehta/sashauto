module Api
  # The current order data of the business view (Business: DTP, GMBH or both for "All"): each business's latest
  # upload plus its manual orders, or (`upload_id`) any earlier upload's rows exactly as imported. Search, sorting and
  # pagination all run in PostgreSQL.
  class OrdersController < ApplicationController
    SEARCH_COLUMNS = %w[po_number po_line_number part_number commodity_type order_type ship_to_location
                        supplier_part_number plant_code].freeze

    # Public sort key => fixed column. Only these can reach ORDER BY.
    SORTS = {
      "type" => "order_rows.order_type", "due_date" => "order_rows.due_date",
      "ship_date" => "order_rows.ship_date", "unit" => "order_rows.unit",
      "plant_code" => "order_rows.plant_code", "po_number" => "order_rows.po_number",
      "po_line_number" => "order_rows.po_line_number",
      "part_number" => "order_rows.part_number",
      "commodity_type" => "order_rows.commodity_type", "qty" => "order_rows.qty",
      "previous_qty" => "order_rows.previous_qty",
      "last_asn_qty" => "order_rows.last_asn_qty",
      "last_asn_date" => "order_rows.last_asn_date",
      "last_receipt_qty" => "order_rows.last_receipt_qty",
      "last_receipt_date" => "order_rows.last_receipt_date",
      "last_packing_list_number" => "order_rows.last_packing_list_number",
      "crossdock_location" => "order_rows.crossdock_location",
      "ship_to_location" => "order_rows.ship_to_location",
      "dock_number" => "order_rows.dock_number",
      "supplier_part_number" => "order_rows.supplier_part_number",
      "last_released_date" => "order_rows.last_released_date",
      "last_updated_date" => "order_rows.last_updated_date"
    }.freeze
    # Oldest Firm Date first (orders without one last).
    DEFAULT_SORT = "firm_date".freeze
    # The business of an imported row: its upload's.
    BUSINESS_SQL = "(SELECT ub.business FROM upload_batches ub WHERE ub.id = order_rows.upload_batch_id) AS business".freeze

    # Columns of order_rows that manual_orders has too (same names and types).
    SHARED_COLUMNS = %w[id group_key po_number part_number order_type ship_date po_line_number ship_to_location
                        commodity_type qty previous_qty effective_qty quantity_source due_date unit plant_code
                        last_asn_qty last_asn_date last_receipt_qty last_receipt_date last_packing_list_number
                        crossdock_location dock_number supplier_part_number last_released_date last_updated_date
                        source_data source_columns created_at].freeze

    def index
      batches = selected_batches
      return render(json: { data: [], meta: pagination_meta(0).last, source: nil }) if batches.empty? && !manual_orders.exists?

      # Every imported row of the upload(s) (not only the current row of each PO + Part + Type).
      dataset = dataset(batches)
      columns = source_columns(batches.first)
      # Every row of the file is listed on its own, as in the file; the rows of a combined order (Orders::Combiner) share
      # its PO, status and Firm Date.
      combined = Orders::Combiner.for_batches(batches.map(&:id))
      load_combined_orders(combined)
      @moq_parts = Orders::MoqBalance.needs(batches.map(&:id))
      scope = filter(search(dataset, (params[:search].presence || params[:q]).to_s.strip.first(100)), combined)
      scope, sort, direction = apply_sort(scope, sorts_for(columns).merge("firm_date" => firm_date_sql), default: DEFAULT_SORT)
      # Manual orders are always listed first; each part keeps the chosen sort.
      scope = scope.reorder(Arel.sql("order_rows.manual DESC"), *scope.order_values)

      rows, meta = if filtered?
        paginate(scope)
      else
        # Stored rows of the upload (row_count is the number after merging identical rows, not what is listed).
        total = OrderRow.where(upload_batch_id: batches.map(&:id)).count +
                (current_view? ? manual_orders.count + kept_ids(batches).size : 0)
        paginate_with_known_total(scope, total)
      end

      ship_to_locations, commodity_types = facets(batches)
      ordered = ordered_by_key(rows)
      order_placed = VendorOrderPlacement.order_placed_keys(ordered.keys)
      deliveries = deliveries_by_key(rows)
      # Dispatched / outbound Qty of each row from the uploaded invoices (by the row's own key).
      own_keys = rows.map { |row| own_key(row) }
      progress = Invoices::Progress.for_keys(own_keys)
      # A combined order's rows show the combined order's Firm Date (the day it reached the MOQ).
      # (By position: an imported row and a manual order can share an id.)
      firm_keys = rows.map { |row| firm_key(row) }
      firm_dates = Orders::FirmDates.for_keys(firm_keys)
      came = came_firm_dates(rows)
      products = Product.where(part_number: rows.map(&:part_number).uniq).pluck(:part_number, :description, :discontinued)
      descriptions = products.to_h { |part, description, _| [ part, description ] }
      discontinued = products.filter_map { |part, _, off| part if off }.to_set
      render json: {
        data: rows.each_with_index.map do |row, i|
          # The order's PO and status (a combined order's on each of its rows).
          key = placement_key(row)
          Serializers.order_row(row, source: true).merge(placed: ordered.key?(key), order_placed: order_placed.include?(key),
                                                         ordered_qty: Serializers.qty(ordered[key]),
                                                         deliveries: deliveries.fetch(key, {}),
                                                         **row_invoice(deliveries.dig(key, "dispatched"), row, progress[own_keys[i]]),
                                                         **invoice_info(row, progress[own_keys[i]], deliveries.fetch(key, {})),
                                                         firm_date: firm_dates[firm_keys[i]], came_firm_date: came[i], business: row[:business],
                                                         part_description: descriptions[row.part_number],
                                                         discontinued: discontinued.include?(row.part_number),
                                                         **combined_info(row, combined))
        end,
        meta: meta.merge(sort: sort, direction: direction),
        # Every Excel column of the upload, in file order; `key` is the sort key.
        columns: columns,
        # The shown upload (the most recent one in "All"), with its business.
        source: (batch = batches.max_by(&:completed_at)) && { uploaded_at: batch.completed_at, original_filename: batch.original_filename,
                                                              upload_id: batch.id, latest: current_view?, business: batch.business },
        # Values present in the current data, for the filter panel.
        facets: { ship_to_locations: ship_to_locations, commodity_types: commodity_types, vendors: vendor_facet(dataset) }
      }
    end

    # Cards above the Orders table, for the current order data (latest upload + manual orders), counting rows of the
    # order file (a combined order counts each of its rows, which share its PO and status). open: Firm / Order rows not
    # yet delivered to Deere (an Outbound mark, or all of the row on SASH Inc invoices); po_pending: open ones with a Qty
    # and no PO generated yet; below_moq: parts that need MOQ (Orders::MoqBalance: Firm Qty less PO issued, still to
    # order, below the MOQ); aged: open ones 90+ days since their order's Firm Date (age group red, on the browser's
    # `today`).
    def summary
      batch_ids = UploadBatch.latest_for(current_business).map(&:id)
      combined = Orders::Combiner.for_batches(batch_ids)
      load_combined_orders(combined)
      anchor_of = @anchor_of
      imported = OrderRow.where(upload_batch_id: batch_ids, order_type: %w[Firm Order]).pluck(:id, :group_key, :po_line_number, :ship_date, :qty)
      keys = imported.to_h { |id, g, line, ship, _| [ id, Digest::SHA256.hexdigest([ g, line, ship.iso8601 ].join(OrderRows::Normalizer::KEY_SEPARATOR)) ] }
      rows = imported.map { |id, *, qty| [ id, keys[anchor_of.fetch(id, id)], qty, false ] }
      rows += manual_orders.where(order_type: %w[Firm Order]).pluck(:id, :qty)
                         .map { |id, qty| [ id, VendorOrderPlacement.order_key(ManualOrder.new(id: id)), qty, true ] }
      delivered = OrderDelivery.active.where(kind: "outbound", order_key: rows.map { |r| r[1] }).distinct.pluck(:order_key).to_set
      # Each row's own key (the invoices are recorded per row, a combined order's rows too).
      own = rows.map { |id, key, _, manual| manual ? key : keys[id] }
      fulfilled = Invoices::Progress.fulfilled_keys(own.zip(rows.map { |r| r[2] }))
      open = rows.each_with_index.reject { |(_, key, *), i| delivered.include?(key) || fulfilled.include?(own[i]) }.map(&:first)
      placed = VendorOrderPlacement.where(order_key: open.map { |r| r[1] }).distinct.pluck(:order_key).to_set
      # The orders of the open rows (a combined order's first row for each of its rows).
      open_orders = open.reject(&:last).map { |id, *| anchor_of.fetch(id, id) }
      aged = Ageing::Rules.in_bands(OrderRow.where(id: open_orders.uniq), [ "red" ], request_today,
                                    combined_ids: combined.groups.values.select(&:combined?).map(&:anchor_id)).pluck(:id).to_set
      # Delivery tabs, counted on the same rows (as the Status column): in transit (Dispatch or Dispatched from
      # Faridabad, not yet at the US warehouse) and fulfilled (delivered to Deere).
      statuses = dataset(UploadBatch.latest_for(current_business)).group(Arel.sql(status_sql)).count
      render json: {
        open: open.size,
        po_pending: open.count { |_, key, qty, _| qty.to_d.positive? && !placed.include?(key) },
        # The rest of the open orders: with a vendor PO, or without a Qty (nothing to order).
        po_generated: open.count { |_, key, *| placed.include?(key) },
        no_qty: open.count { |_, key, qty, _| !qty.to_d.positive? && !placed.include?(key) },
        below_moq: Orders::MoqBalance.needs(batch_ids).values.sum(&:size),
        aged: open_orders.count { |id| aged.include?(id) },
        in_transit: statuses["dispatch"].to_i + statuses["dispatched"].to_i,
        fulfilled: statuses["outbound"].to_i
      }
    end

    # Order detail of one row: every row of the same upload with the same PO Number + Part Number + Type
    # (the clicked row included), ordered by PO Line Number then Ship Date, plus the product Description, each
    # row's Effective Firm Date and Firm Date (came_firm_date) and the combined orders among them (`combined`; `candidate_ids`: orders an admin can add).
    def history
      return manual_history(ManualOrder.active.find(params[:id])) if params[:manual] == "1"

      row = OrderRow.find(params[:id])
      rows = OrderRow.where(upload_batch_id: row.upload_batch_id, group_key: row.group_key)
                     .order(:po_line_number, :ship_date, :source_row_number).limit(1_000)
      firm_dates = Orders::FirmDates.for_keys(rows.map { |r| VendorOrderPlacement.order_key(r) })
      combined = Orders::Combiner.call(row.upload_batch_id)
      groups = combined.groups.values.select { |g| Orders::Merges.shown?(g) && g.members.first.group_key == row.group_key }
      came = came_firm_dates(rows.to_a)
      # Each row's dispatch figures from the uploaded invoices (Invoice No., Order / Shipped / Balance Qty), as on the list.
      keys = rows.map { |r| VendorOrderPlacement.order_key(r) }
      progress = Invoices::Progress.for_keys(keys)
      listed = listed_marks(keys)
      render json: {
        data: rows.each_with_index.map do |r, i|
          key = keys[i]
          # The dispatched orders list's invoice numbers of this row (an uploaded SASH India invoice shows instead).
          list_invoices = Array(listed.dig(key, "dispatched", :invoice_lines)).select { |l| l["order_key"] == key }.filter_map { |l| l["invoice"] }.uniq
          Serializers.order_row(r, source: true).merge(firm_date: firm_dates[key], came_firm_date: came[i], dispatch_invoice: list_invoices.join(", ").presence,
                                                       **invoice_info(r, progress[key], listed[key] || {}).except(:status))
        end,
        headers: row.source_columns.presence || row.source_data.keys,
        group: group_info(row),
        combined: groups.map { |g| schedule_group(g, combined) },
        invoices: invoice_moves(rows.map { |r| VendorOrderPlacement.order_key(r) })
      }
    end

    # Product summary (click a Part Number): the part's orders in the shown order data (see #dataset) with, for its
    # Firm / Order rows, the Qty ordered, dispatched from India (SASH India invoices or the dispatched orders list), in
    # transit, delivered to Deere (SASH Inc invoices or Outbound) and still to dispatch, as the Orders list shows each row,
    # and the revenue (Qty × Deere Unit Price ÷ 100, as on the Dashboard) of what was ordered and delivered; totals, per
    # PO, its Forecast Qty and vendor PO Qty, and the product with each vendor's price.
    def part_summary
      part = OrderRows::Normalizer.part_number(params.require(:part).to_s)
      batches = selected_batches
      load_combined_orders(Orders::Combiner.for_batches(batches.map(&:id)))
      rows = dataset(batches).where(part_number: part).to_a
      lines = summary_lines(rows)
      placed = ordered_by_key(rows)
      product = Product.includes(vendor_products: :vendor).find_by(part_number: part)
      render json: { data: {
        part_number: part, description: product&.description, moq: Serializers.qty(product && (product.moq_sets || product.moq)),
        pack_size: product&.pack_size, discontinued: product&.discontinued? || false, currency: summary_currency,
        vendors: (product&.vendor_products || []).sort_by { |vp| vp.vendor.name }.map do |vp|
          { name: vp.vendor.name, price: Serializers.qty(vp.price_amount), set_price: Serializers.qty(vp.set_price_amount), currency: vp.price_currency,
            price_text: vp.price_text, note: vp.price_note, pack_size: vp.pack_size, moq: vp.moq_text.presence || Serializers.qty(vp.moq_sets) }
        end,
        totals: summary_figures(lines).merge(forecast: Serializers.qty(rows.select { |r| r.order_type == "Forecast" }.sum(0.to_d) { |r| r.qty.to_d }),
                                             vendor_po: Serializers.qty(placed.values.sum(0.to_d)), pos: lines.map { |l| l[:row].po_number }.uniq.size),
        pos: lines.group_by { |l| l[:row].po_number }.sort_by { |po, list| [ list.map { |l| l[:row].ship_date }.min, po ] }.map do |po, list|
          open = list.select { |l| l[:ordered] > l[:shipped] }
          summary_figures(list).merge(po_number: po, types: list.map { |l| l[:row].order_type }.uniq.sort,
                                      next_ship_date: open.map { |l| l[:row].ship_date }.min, last_ship_date: list.map { |l| l[:row].ship_date }.max)
        end
      } }
    end

    # Product-wise summary (Products → Product summary): every part of the shown order data with the same figures as its
    # Product summary (#part_summary), largest revenue first.
    def parts_summary
      batches = selected_batches
      load_combined_orders(Orders::Combiner.for_batches(batches.map(&:id)))
      rows = dataset(batches).to_a
      lines = summary_lines(rows)
      products = Product.where(part_number: rows.map(&:part_number).uniq).pluck(:part_number, :description, :moq_sets, :moq).to_h { |p, *v| [ p, v ] }
      forecast = rows.select { |r| r.order_type == "Forecast" }.group_by(&:part_number).transform_values { |l| l.sum(0.to_d) { |r| r.qty.to_d } }
      data = lines.group_by { |l| l[:row].part_number }.map do |part, list|
        description, moq_sets, moq = products[part]
        summary_figures(list).merge(part_number: part, description: description, moq: Serializers.qty(moq_sets || moq),
                                    forecast: Serializers.qty(forecast[part] || 0), pos: list.map { |l| l[:row].po_number }.uniq.size)
      end
      render json: { data: data.sort_by { |d| -d[:revenue_ordered].to_d }, currency: summary_currency }
    end

    # Firm / Order rows of `rows` (a list of the shown order data) with what the Orders list shows for each: Qty ordered,
    # dispatched (invoices, the dispatched orders list or a Dispatched mark), delivered (SASH Inc invoices or Outbound)
    # and the Deere Unit Price (the row's, else the product's customer price; per 100 pcs).
    def summary_lines(rows)
      deliveries = deliveries_by_key(rows)
      own_keys = rows.map { |row| own_key(row) }
      progress = Invoices::Progress.for_keys(own_keys)
      fallback = Product.where(part_number: rows.map(&:part_number).uniq).pluck(:part_number, :customer_price).to_h
      rows.each_with_index.filter_map do |row, i|
        next if row.order_type == "Forecast"

        info = invoice_info(row, progress[own_keys[i]], deliveries.fetch(placement_key(row), {}))
        ordered = info[:order_qty].to_d
        shipped = info[:shipped_qty] ? info[:shipped_qty].to_d : (%w[dispatched inbound outbound].include?(info[:status]) ? ordered : 0.to_d)
        delivered = info[:outbound_qty] ? info[:outbound_qty].to_d : (info[:status] == "outbound" ? ordered : 0.to_d)
        text = row.source_data&.dig("Unit Price").to_s.delete(",").strip
        price = text.match?(/\A\d+(\.\d+)?\z/) ? BigDecimal(text) : fallback[row.part_number]
        { row: row, ordered: ordered, shipped: shipped, delivered: delivered, price: price }
      end
    end

    # Totals of summary lines: Qty ordered, dispatched, in transit, delivered, still to dispatch, orders (open), and the
    # revenue of the Qty ordered and delivered (Qty × price ÷ 100; lines without a price left out, counted in unpriced).
    def summary_figures(lines)
      ordered, shipped, delivered = %i[ordered shipped delivered].map { |k| lines.sum(0.to_d) { |l| l[k] } }
      priced = lines.select { |l| l[:price] }
      { ordered: Serializers.qty(ordered), dispatched: Serializers.qty(shipped), in_transit: Serializers.qty([ shipped - delivered, 0 ].max),
        delivered: Serializers.qty(delivered), pending: Serializers.qty([ ordered - shipped, 0 ].max), orders: lines.size,
        open_orders: lines.count { |l| l[:ordered] > l[:shipped] },
        revenue_ordered: (priced.sum(0.to_d) { |l| l[:ordered] * l[:price] / 100 }).round(2).to_s("F"),
        revenue_delivered: (priced.sum(0.to_d) { |l| l[:delivered] * l[:price] / 100 }).round(2).to_s("F"),
        unpriced: lines.size - priced.size }
    end

    # The currency of the view's Deere prices (Settings), or nil when the businesses shown use different ones.
    def summary_currency
      currencies = businesses.map { |b| Business.currency(b) }.uniq
      currencies.one? ? currencies.first : nil
    end

    # Part Numbers ordered under one PO Number (the shown order data; see #dataset).
    def by_po
      render json: { data: related(:po_number, params.require(:po).to_s, :part_number) }
    end

    # PO Numbers containing one Part Number (the shown order data; see #dataset).
    def by_part
      render json: { data: related(:part_number, OrderRows::Normalizer.part_number(params.require(:part).to_s), :po_number) }
    end

    private

    # Statuses in route order: dispatch (part of the Qty dispatched on SASH India invoices) and dispatched (all of it, or a
    # Dispatched mark) come from Faridabad.
    STATUSES = %w[none received dispatch dispatched inbound outbound].freeze
    STATUS_ARRAY_SQL = "(ARRAY[#{STATUSES.map { |s| "'#{s}'" }.join(', ')}]::text[])".freeze

    # Allocations of the active uploaded invoices (Invoices::Progress).
    ALLOCATIONS_SQL = "invoice_allocations a JOIN invoices i ON i.id = a.invoice_id AND i.removed_at IS NULL".freeze

    # Position in STATUSES (1 = none) of a listed row's status from the uploaded invoices (Invoices::Progress, by the row's
    # own Qty: dispatch, dispatched or outbound). As in CURRENT_STATUS_SQL an uncorrelated IN finds the rows with
    # allocations; only those sum their own.
    INVOICE_STATUS_SQL = begin
      order = "(order_rows.po_number, order_rows.part_number, order_rows.order_type, order_rows.po_line_number, order_rows.ship_date)"
      shipped = "COALESCE(SUM(a.qty) FILTER (WHERE i.kind = 'india'), 0)"
      outbound = "COALESCE(SUM(a.qty) FILTER (WHERE i.kind = 'inc'), 0)"
      total = "GREATEST(COALESCE(MAX(a.order_qty), 0), COALESCE(order_rows.qty, 0))"
      position = "CASE WHEN #{outbound} > 0 AND #{outbound} >= #{total} THEN 6 WHEN #{shipped} <= 0 THEN 1 WHEN #{shipped} >= #{total} THEN 4 ELSE 3 END"
      imported = "a.manual_order_id IS NULL AND a.po_number = order_rows.po_number AND a.part_number = order_rows.part_number " \
                 "AND a.order_type = order_rows.order_type AND a.po_line_number = order_rows.po_line_number AND a.ship_date = order_rows.ship_date"
      "(CASE WHEN order_rows.manual AND order_rows.id IN (SELECT a.manual_order_id FROM #{ALLOCATIONS_SQL} WHERE a.manual_order_id IS NOT NULL) " \
        "THEN (SELECT #{position} FROM #{ALLOCATIONS_SQL} WHERE a.manual_order_id = order_rows.id) " \
        "WHEN NOT order_rows.manual AND #{order} IN (SELECT a.po_number, a.part_number, a.order_type, a.po_line_number, a.ship_date " \
        "FROM #{ALLOCATIONS_SQL} WHERE a.manual_order_id IS NULL) THEN (SELECT #{position} FROM #{ALLOCATIONS_SQL} WHERE #{imported}) ELSE 1 END)".freeze
    end

    # Furthest status mark of a listed row, or 'none'. One uncorrelated IN per kind, furthest
    # first: PostgreSQL hashes each once per query instead of scanning order_deliveries for every row.
    CURRENT_STATUS_SQL = begin
      order = "(order_rows.po_number, order_rows.part_number, order_rows.order_type, order_rows.po_line_number, order_rows.ship_date)"
      whens = %w[outbound inbound dispatched received].map do |kind|
        marks = "FROM order_deliveries d WHERE d.removed_at IS NULL AND d.kind = '#{kind}'"
        "WHEN order_rows.manual AND order_rows.id IN (SELECT d.manual_order_id #{marks}) THEN '#{kind}' " \
          "WHEN NOT order_rows.manual AND #{order} IN (SELECT d.po_number, d.part_number, d.order_type, d.po_line_number, d.ship_date " \
          "#{marks} AND d.manual_order_id IS NULL) THEN '#{kind}'"
      end
      "(CASE #{whens.join(' ')} ELSE 'none' END)".freeze
    end

    # Status filter (status=none,received,dispatch,…); without it, fulfilled orders (outbound) are left out.
    def filter_by_status(scope)
      statuses = multi_param(:status, STATUSES)
      return scope.where("#{status_sql} <> 'outbound'") if statuses.empty?

      scope.where("#{status_sql} IN (?)", statuses)
    end

    # The rows of the combined orders (Orders::Combiner): @anchor_of (row id => the combined order's first row) and
    # @combined_keys (row id => the combined order's placement key, its first row's: its PO, status and Firm Date are
    # recorded there).
    def load_combined_orders(combined)
      @anchor_of = {}
      @combined_keys = {}
      combined.groups.each_value do |g|
        next unless g.combined?

        key = VendorOrderPlacement.order_key(g.members.find { |m| m.id == g.anchor_id })
        g.members.each do |m|
          @anchor_of[m.id] = g.anchor_id
          @combined_keys[m.id] = key
        end
      end
    end

    # For an imported row: below_moq when its part needs MOQ (Orders::MoqBalance; its MOQ and the balance still to order
    # with it); for a row of a combined order, member_of: the combined order's first row (what its PO and status are
    # recorded on), its total Qty and how many rows it combines.
    def combined_info(row, combined)
      return {} if row[:manual]

      part = @moq_parts.dig(row[:upload_batch_id], row.part_number)
      info = { below_moq: !part.nil?, moq: part && Serializers.qty(part.moq), moq_balance: part && Serializers.qty(part.balance) }
      anchor_id = @anchor_of.fetch(row.id, row.id)
      group = combined.groups[anchor_id]
      return info unless group&.combined?

      info.merge(member_of: { id: anchor_id, total: Serializers.qty(group.total), count: group.members.size })
    end

    # Order details header of a row's PO Number + Part Number + Type: the part's Description (the file's, as on the
    # Orders page, else the product's) and MOQ (sets, and pieces for pack parts).
    def group_info(row)
      product = Product.find_by(part_number: row.part_number)
      from_file = row.source_data.find { |label, value| label.strip.casecmp?("description") && value.to_s.strip.present? }&.last.to_s.squish
      { po_number: row.po_number, part_number: row.part_number, order_type: row.order_type, description: from_file.presence || product&.description,
        moq: Serializers.qty(product && (product.moq_sets || product.moq)), moq_pcs: Serializers.qty(product&.moq),
        pack_size: product&.pack_size || 1 }
    end

    # A combined order in the Order details Schedule. PO generated (placed): its orders can no longer change.
    def schedule_group(group, combined)
      anchor = OrderRow.find(group.anchor_id)
      { anchor_id: group.anchor_id, member_ids: group.members.map(&:id), manual_ids: group.manual_ids, removed_ids: group.removed_ids,
        total: Serializers.qty(group.total), moq: Serializers.qty(group.moq), below_moq: group.below_moq?,
        placed: VendorOrderPlacement.exists?(order_key: VendorOrderPlacement.order_key(anchor)),
        # The combined order's Firm Date: the day it reached the MOQ (its orders keep their own).
        firm_date: OrderFirmDate.find_by(order_key: Orders::FirmDates.combined_key(VendorOrderPlacement.order_key(anchor)))&.firm_on,
        candidate_ids: current_user.can?(:orders, :edit) ? Orders::Merges.candidates(anchor, combined).map(&:id) : [] }
    end

    # The Firm Date of a listed row in SQL (sorting, filters): the combined order's own date for its rows, none for manual
    # orders (as shown on the page).
    def firm_date_sql
      "(SELECT f.firm_on FROM order_firm_dates f WHERE NOT order_rows.manual AND f.order_key = #{firm_key_sql})"
    end

    # The Firm Date key of a listed row in SQL: the combined order's own key (FirmDates.combined_key) for its rows.
    def firm_key_sql
      own = Orders::FirmDates.key_sql("order_rows")
      return own if @combined_keys.empty?

      firm = @combined_keys.transform_values { |key| Orders::FirmDates.combined_key(key) }
      "(CASE WHEN order_rows.manual THEN #{own} ELSE (CASE order_rows.id #{when_ids(firm)} ELSE #{own} END) END)"
    end

    # The placement key of a listed row in SQL (VendorOrderPlacement.order_key): by id for manual orders, the combined
    # order's for its rows.
    def order_key_sql
      own = Orders::FirmDates.key_sql("order_rows")
      imported = @combined_keys.empty? ? own : "(CASE order_rows.id #{when_ids(@combined_keys)} ELSE #{own} END)"
      "(CASE WHEN order_rows.manual THEN encode(sha256(convert_to('manual' || chr(31) || order_rows.id::text, 'UTF8')), 'hex') ELSE #{imported} END)"
    end

    # The current status of a listed row in SQL: the further of its status marks' (the combined order's for its rows) and
    # its uploaded invoices' (its own, INVOICE_STATUS_SQL).
    def status_sql
      "#{STATUS_ARRAY_SQL}[GREATEST(array_position(#{STATUS_ARRAY_SQL}, #{mark_status_sql}::text), #{INVOICE_STATUS_SQL})]"
    end

    # The furthest status mark of a listed row in SQL (CURRENT_STATUS_SQL): the combined order's for its rows.
    def mark_status_sql
      return CURRENT_STATUS_SQL if @combined_keys.empty?

      ids = @combined_keys.keys.map { |id| Integer(id) }.join(",")
      combined = "COALESCE((SELECT d.kind FROM order_deliveries d WHERE d.removed_at IS NULL AND d.order_key = (CASE order_rows.id #{when_ids(@combined_keys)} END) " \
                 "ORDER BY array_position(ARRAY['received', 'dispatched', 'inbound', 'outbound']::varchar[], d.kind) DESC LIMIT 1), 'none')"
      "(CASE WHEN NOT order_rows.manual AND order_rows.id IN (#{ids}) THEN #{combined} ELSE #{CURRENT_STATUS_SQL} END)"
    end

    # "WHEN id THEN 'value' …" of a CASE order_rows.id.
    def when_ids(values)
      values.map { |id, value| "WHEN #{Integer(id)} THEN #{OrderRow.connection.quote(value)}" }.join(" ")
    end

    # Key of a listed row's Firm Date: the combined order's own key for its rows.
    def firm_key(row)
      key = placement_key(row)
      !row[:manual] && @combined_keys.key?(row.id) ? Orders::FirmDates.combined_key(key) : key
    end

    # Placement key of a listed row (an imported row, or a manual order listed with `manual`): the combined order's (its
    # first row's) for the rows of a combined order.
    def placement_key(row)
      return VendorOrderPlacement.order_key(ManualOrder.new(id: row.id)) if row[:manual]

      @combined_keys&.dig(row.id) || VendorOrderPlacement.order_key(row)
    end

    # The SASH India invoice shown on a listed row (dispatch_invoice) and all of the row's invoices (dispatch_invoices).
    # Uploaded SASH India invoices that dispatched Qty of this row (`progress`, Invoices::Progress): the latest, all with
    # date and Qty. Otherwise a Dispatched mark (set before invoice uploads) with its invoices one by one (invoice_lines,
    # from the former dispatched orders list): those sent for this row (a combined order's rows each show their own), the
    # one with the row's Qty shown (Deere's Qty is what is still open, so an earlier part shipment has another Qty), else
    # the latest. Otherwise the mark's invoice number.
    def row_invoice(dispatched, row, progress)
      india = progress&.moves.to_a.select { |move| move.kind == "india" }
      if india.any?
        return { dispatch_invoice: india.last.invoice_number,
                 dispatch_invoices: india.map { |m| "#{m.invoice_number} (#{m.invoice_date.iso8601}, Qty #{Serializers.qty(m.qty)})" } }
      end
      return { dispatch_invoice: nil, dispatch_invoices: [] } unless dispatched
      if dispatched[:invoice_lines].blank?
        return { dispatch_invoice: dispatched[:invoice_number], dispatch_invoices: [ dispatched[:invoice_number] ].compact }
      end

      own = own_key(row)
      lines = dispatched[:invoice_lines].select { |line| line["order_key"] == own }.sort_by { |line| line["date"].to_s }
      shown = lines.find { |line| row.qty && line["qty"].present? && BigDecimal(line["qty"]) == row.qty } || lines.last
      { dispatch_invoice: shown&.dig("invoice"),
        dispatch_invoices: lines.map { |line| "#{line['invoice']} (#{line['date']}#{", Qty #{line['qty']}" if line['qty']})" }.uniq }
    end

    # A listed row's own order key (not its combined order's): the key its invoices are recorded on.
    def own_key(row)
      row[:manual] ? placement_key(row) : VendorOrderPlacement.order_key(row)
    end

    # A listed row's Qty columns from the uploaded invoices (Invoices::Progress `progress`, nil without any): Order Qty
    # (the Qty when dispatched, when higher than Deere's open Qty now), Shipped Qty (dispatched on SASH India invoices),
    # Balance Qty (still to send), Outbound Qty (delivered on SASH Inc invoices), each invoice move, and the status: the
    # further of its marks' (`marks`, kind => mark) and its invoices'.
    def invoice_info(row, progress, marks)
      mark = OrderDelivery::KINDS.reverse.find { |kind| marks.key?(kind) } || "none"
      from_invoices = progress&.status(row.qty)
      status = [ mark, from_invoices ].compact.max_by { |kind| STATUSES.index(kind) }
      # Sent by the dispatched orders list (no SASH India invoice Qty): its Qty on the list counts as shipped.
      listed = progress&.shipped&.positive? ? 0.to_d : listed_qty(row, marks["dispatched"])
      if progress.nil? && listed.zero?
        return { status: status, order_qty: Serializers.qty(row.qty), shipped_qty: nil, balance_qty: Serializers.qty(row.qty), outbound_qty: nil, invoice_moves: [] }
      end

      shipped = (progress&.shipped || 0.to_d) + listed
      # At least what was sent: Deere's Qty drops as it receives (e.g. 4 open of 150 sent on the dispatched list).
      order_qty = [ progress ? progress.order_qty(row.qty) : row.qty.to_d, shipped ].max
      { status: status, order_qty: Serializers.qty(order_qty), shipped_qty: Serializers.qty(shipped),
        balance_qty: Serializers.qty([ order_qty - shipped, 0.to_d ].max), outbound_qty: progress&.outbound&.positive? ? Serializers.qty(progress.outbound) : nil,
        invoice_moves: (progress&.moves || []).map { |m| { kind: m.kind, invoice_id: m.invoice_id, invoice_number: m.invoice_number, invoice_date: m.invoice_date, qty: Serializers.qty(m.qty) } } }
    end

    # Order key => { "dispatched" => mark } of the Dispatched marks on these keys or naming them on their list lines.
    def listed_marks(keys)
      marks = OrderDelivery.active.where(kind: "dispatched")
                           .where("order_key IN (:keys) OR EXISTS (SELECT 1 FROM jsonb_array_elements(invoice_lines) l WHERE l->>'order_key' IN (:keys))", keys: keys)
      marks.each_with_object({}) do |d, by_key|
        mark = { "dispatched" => { invoice_lines: d.invoice_lines } }
        by_key[d.order_key] ||= mark if keys.include?(d.order_key)
        d.invoice_lines.each { |line| by_key[line["order_key"]] ||= mark if keys.include?(line["order_key"]) }
      end
    end

    # Qty of a row sent on a Dispatched mark (`mark`, serialized): its lines on the dispatched orders list (their Qty, the
    # row's Qty when a line has none), or all of it when the mark names no lines (marked by hand).
    def listed_qty(row, mark)
      return 0.to_d unless mark

      lines = Array(mark[:invoice_lines])
      return row.qty.to_d if lines.empty?

      own = row[:manual] ? VendorOrderPlacement.order_key(ManualOrder.new(id: row.id)) : VendorOrderPlacement.order_key(row)
      lines.select { |line| line["order_key"] == own }.sum(0.to_d) { |line| line["qty"].present? ? BigDecimal(line["qty"].to_s) : row.qty.to_d }
    end

    # Every dispatch and outbound of the orders with these keys, oldest first: the invoice (kind, number, date, file),
    # the order row (PO Line, Ship Date), the Qty and Order Qty, who uploaded it and when.
    def invoice_moves(keys)
      InvoiceAllocation.active.includes(invoice: [ :uploaded_by, { file_attachment: :blob } ]).where(order_key: keys.uniq)
                       .order("invoices.invoice_date", "invoices.id", :id).map do |a|
        invoice = a.invoice
        { id: a.id, invoice_id: invoice.id, kind: invoice.kind, label: invoice.label, invoice_number: invoice.invoice_number,
          invoice_date: invoice.invoice_date, po_line_number: a.po_line_number, ship_date: a.ship_date, order_type: a.order_type,
          manual_order_id: a.manual_order_id, qty: Serializers.qty(a.qty), order_qty: Serializers.qty(a.order_qty),
          uploaded_by: invoice.uploaded_by&.name, uploaded_at: invoice.created_at, filename: invoice.original_filename,
          has_file: invoice.file.attached? }
      end
    end

    # Sets ordered so far (Generate PO) per placement key of the listed rows (in one query).
    def ordered_by_key(rows)
      VendorOrderPlacement.where(order_key: rows.map { |row| placement_key(row) }).group(:order_key)
                          .sum(Arel.sql("COALESCE(allocated_qty, order_qty)"))
    end

    # Active inbound / outbound delivery marks of the listed rows: { key => { "inbound" => {...}, "outbound" => {...} } }.
    def deliveries_by_key(rows)
      OrderDelivery.active.includes(:marked_by).where(order_key: rows.map { |row| placement_key(row) })
                   .group_by(&:order_key)
                   .transform_values { |list| list.to_h { |d| [ d.kind, Serializers.order_delivery(d) ] } }
    end

    # [Ship To Locations, Commodity Types] present in the shown data, sorted.
    # Upload batches are immutable, so batch facets are cached in memory.
    def facets(batches)
      parts = batches.map do |batch|
        Rails.cache.fetch("order_rows_facets_batch_#{batch.id}") do
          OrderRow.where(upload_batch_id: batch.id).pick(
            Arel.sql("COALESCE(array_agg(DISTINCT order_rows.ship_to_location ORDER BY order_rows.ship_to_location), '{}')"),
            Arel.sql("COALESCE(array_agg(DISTINCT order_rows.commodity_type ORDER BY order_rows.commodity_type) " \
                     "FILTER (WHERE order_rows.commodity_type IS NOT NULL), '{}')")
          ) || [ [], [] ]
        end
      end
      if current_view? && manual_orders.exists?
        parts << (manual_orders.pick(
          Arel.sql("COALESCE(array_agg(DISTINCT ship_to_location ORDER BY ship_to_location), '{}')"),
          Arel.sql("COALESCE(array_agg(DISTINCT commodity_type ORDER BY commodity_type) FILTER (WHERE commodity_type IS NOT NULL), '{}')")
        ) || [ [], [] ])
      end
      [ parts.flat_map(&:first).uniq.sort, parts.flat_map(&:last).uniq.sort ]
    end

    # A manual order has no other rows: its history is itself.
    def manual_history(order)
      render json: {
        data: [ Serializers.order_row(order, source: true) ],
        headers: order.source_columns,
        group: group_info(order),
        invoices: invoice_moves([ VendorOrderPlacement.order_key(order) ])
      }
    end

    # The uploads whose rows are shown: `upload_id` (any completed upload), else the latest upload of each business of
    # the view.
    def selected_batches
      @selected_batches ||= params[:upload_id].present? ? [ UploadBatch.completed.find(params[:upload_id]) ] : UploadBatch.latest_for(current_business)
    end

    # The current order data (latest uploads) includes the manual orders; an earlier upload shows only its rows.
    def current_view?
      params[:upload_id].blank?
    end

    # Active manual orders of the view's businesses.
    def manual_orders
      ManualOrder.active.where(business: businesses)
    end

    # The uploads' rows, plus (current view) the manual orders and the kept rows (see #kept_rows), as one
    # `order_rows` relation so the search, filters, sorting and pagination below apply to all. Each row has
    # `manual` and `kept` (true/false).
    def dataset(batches)
      # The business of each upload is known here (BUSINESS_SQL would look it up for every row).
      business = batches.map { |b| "WHEN #{Integer(b.id)} THEN #{OrderRow.connection.quote(b.business)}" }.join(" ")
      imported = OrderRow.where(upload_batch_id: batches.map(&:id))
                         .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                                 "false AS manual", "false AS kept", batches.empty? ? BUSINESS_SQL : "(CASE order_rows.upload_batch_id #{business} END) AS business")
      return OrderRow.from("(#{imported.to_sql}) AS order_rows") unless current_view?

      manual = manual_orders.select(*SHARED_COLUMNS, "NULL::bigint AS upload_batch_id", "NULL::integer AS source_row_number",
                                    "true AS current", "1 AS group_row_count", "true AS manual", "false AS kept", "business")
      kept = OrderRow.where(id: kept_ids(batches))
                     .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                             "false AS manual", "true AS kept", BUSINESS_SQL)
      OrderRow.from("(#{imported.to_sql} UNION ALL #{manual.to_sql} UNION ALL #{kept.to_sql}) AS order_rows")
    end

    # Orders of the view's businesses placed with vendors, with an active status mark or on an uploaded invoice that are
    # no longer in their business's latest upload: like manual orders they stay on the Orders page. One row per order (PO + Part + Type +
    # PO Line + Ship Date), its last version.
    def kept_rows(batches)
      ids = batches.map { |b| Integer(b.id) }.presence || [ 0 ]
      names = businesses.map { |b| OrderRow.connection.quote(b) }.join(",")
      OrderRow.from(<<~SQL.squish)
        (SELECT DISTINCT ON (r.group_key, r.po_line_number, r.ship_date) r.id
         FROM order_rows r JOIN upload_batches b ON b.id = r.upload_batch_id AND b.business IN (#{names})
         WHERE r.upload_batch_id NOT IN (#{ids.join(',')})
           AND r.id IN (SELECT d.order_row_id FROM order_deliveries d WHERE d.removed_at IS NULL
                        UNION SELECT p.order_row_id FROM vendor_order_placements p
                        UNION SELECT a.order_row_id FROM #{ALLOCATIONS_SQL} WHERE a.order_row_id IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM order_rows n WHERE n.upload_batch_id IN (#{ids.join(',')})
                           AND n.group_key = r.group_key AND n.po_line_number = r.po_line_number AND n.ship_date = r.ship_date)
         ORDER BY r.group_key, r.po_line_number, r.ship_date, r.upload_batch_id DESC) AS order_rows
      SQL
    end

    # Ids of the kept rows (see #kept_rows), looked up once per request: the dataset is queried several times (page,
    # count, vendor facet).
    def kept_ids(batches)
      @kept_ids ||= {}
      @kept_ids[batches.map(&:id)] ||= kept_rows(batches).pluck(:id)
    end

    # Headers of the upload in file order; the 47 manual order columns when there is no upload yet.
    def source_columns(batch)
      return ManualOrder::HEADERS.map { |h| { key: h.parameterize(separator: "_"), label: h } } if batch.nil?

      Rails.cache.fetch("order_source_columns_batch_#{batch.id}") do
        headers = OrderRow.where(upload_batch_id: batch.id).where.not(source_columns: nil).pick(:source_columns) || ManualOrder::HEADERS
        headers.map { |h| { key: h.parameterize(separator: "_"), label: h } }
      end
    end

    # Whether the request has any search or filter active.
    def filtered?
      # Fulfilled (delivered to Deere) orders are hidden by default, so the stored row count no longer applies.
      OrderDelivery.active.where(kind: "outbound").exists? || InvoiceAllocation.active.where(invoices: { kind: "inc" }).exists? ||
        params[:status].present? ||
        (params[:search].presence || params[:q].presence).present? ||
        params[:type].present? || params[:ship_to].present? || params[:commodity_type].present? ||
        params[:ship_date_from].present? || params[:ship_date_to].present? || params[:age].present? || params[:po].present? || params[:combined].present? ||
        %i[moq timing source vendor firm_date_from firm_date_to].any? { |k| params[k].present? }
    end

    # SORTS plus the Excel columns without a typed column, sorted by their imported value
    # (numbers numerically, blank cells last). Headers come from the stored upload, never from params.
    def sorts_for(columns)
      table = OrderRow.arel_table
      extras = columns.reject { |c| SORTS.key?(c[:key]) }.to_h do |c|
        header = Arel::Nodes.build_quoted(c[:label])
        text = Arel::Nodes::NamedFunction.new("btrim", [ Arel::Nodes::InfixOperation.new("->>", table[:source_data], header) ])
        value = Arel::Nodes::InfixOperation.new("->", table[:source_data], header)
        [ c[:key], Arel::Nodes::Case.new.when(text.eq("")).then(Arel.sql("NULL")).else(value) ]
      end
      SORTS.merge(extras)
    end

    # [{ value:, types:, rows: }] for the other side of a PO <-> Part relation, from one grouped query.
    def related(column, value, other)
      dataset(selected_batches).where(column => value).group(other).order(other)
            .pluck(other, Arel.sql("array_agg(DISTINCT order_type ORDER BY order_type)"), Arel.sql("COUNT(*)"))
            .map { |v, types, count| { value: v, types: types, rows: count } }
    end

    # Exact-match filters (several values each) plus an inclusive ship date range (ISO dates; invalid dates are ignored).
    # `combined`: the upload's combined orders, whose first rows are aged by the combined order's Firm Date.
    def filter(scope, combined)
      # Each filter accepts several values (comma-separated).
      types = multi_param(:type, OrderRows::Normalizer::ORDER_TYPES)
      ship_tos = multi_param(:ship_to)
      commodities = multi_param(:commodity_type)
      scope = scope.where(order_type: types) if types.any?
      scope = scope.where(ship_to_location: ship_tos) if ship_tos.any?
      scope = scope.where(commodity_type: commodities) if commodities.any?
      ages = multi_param(:age, AGE_GROUPS)
      scope = Ageing::Rules.in_bands(scope, ages, request_today, firm_key: firm_key_sql) if ages.any?
      scope = filter_by_status(scope)
      scope = filter_by_po(scope)
      scope = filter_by_combined(scope)
      scope = filter_by_moq(scope)
      scope = filter_by_timing(scope)
      scope = filter_by_source(scope)
      scope = filter_by_vendor(scope)
      scope = filter_by_firm_date(scope)
      from = iso_date(params[:ship_date_from])
      to = iso_date(params[:ship_date_to])
      scope = scope.where("order_rows.ship_date >= ?", from) if from
      scope = scope.where("order_rows.ship_date <= ?", to) if to
      scope
    end

    # Vendors that supply a part of the listed orders, for the Vendor filter: [{ id, name }].
    def vendor_facet(dataset)
      Vendor.joins(vendor_products: :product).where(products: { part_number: dataset.unscope(:order).select(:part_number) })
            .distinct.order(:name).pluck(:id, :name).map { |id, name| { id: id, name: name } }
    end

    # The part's MOQ in sets (what order Qty counts), in SQL.
    MOQ_SQL = "(SELECT COALESCE(p.moq_sets, p.moq) FROM products p WHERE p.part_number = order_rows.part_number)".freeze

    # MOQ filter (moq=below,reached): the rows of parts that need MOQ (Orders::MoqBalance; a manual order by its own Qty),
    # or the others with a Qty, for parts with an MOQ.
    def filter_by_moq(scope)
      values = multi_param(:moq, %w[below reached])
      return scope if values.empty? || values.size == 2

      parts = @moq_parts.flat_map do |batch_id, list|
        list.keys.map { |part| OrderRow.sanitize_sql_array([ "(order_rows.upload_batch_id = ? AND order_rows.part_number = ?)", batch_id, part ]) }
      end
      below = "((NOT order_rows.manual AND #{parts.any? ? "(#{parts.join(' OR ')})" : 'FALSE'}) OR " \
              "(order_rows.manual AND order_rows.qty > 0 AND order_rows.qty < #{MOQ_SQL}))"
      values == [ "below" ] ? scope.where(below) : scope.where("order_rows.qty > 0 AND #{MOQ_SQL} IS NOT NULL AND NOT #{below}")
    end

    # Ship timing filter (timing=overdue,next30): ship date before today, or from today to 30 days ahead (today = the
    # browser's IST date, as the age colours).
    def filter_by_timing(scope)
      values = multi_param(:timing, %w[overdue next30])
      return scope if values.empty?

      today = request_today
      ship = "order_rows.ship_date"
      conditions = values.map do |v|
        v == "overdue" ? ActiveRecord::Base.sanitize_sql([ "#{ship} < ?", today ]) : ActiveRecord::Base.sanitize_sql([ "#{ship} BETWEEN ? AND ?", today, today + 30 ])
      end
      scope.where(conditions.map { |c| "(#{c})" }.join(" OR "))
    end

    # Source filter (source=upload,manual): rows of the uploaded file, or manual orders.
    def filter_by_source(scope)
      values = multi_param(:source, %w[upload manual])
      return scope if values.empty? || values.size == 2

      scope.where(manual: values == [ "manual" ])
    end

    # Vendor filter (vendor=id,id): orders whose part one of these vendors supplies.
    def filter_by_vendor(scope)
      ids = multi_param(:vendor).filter_map { |v| Integer(v, exception: false) }
      return scope if ids.empty?

      scope.where("EXISTS (SELECT 1 FROM vendor_products vp JOIN products p ON p.id = vp.product_id " \
                  "WHERE p.part_number = order_rows.part_number AND vp.vendor_id IN (?))", ids)
    end

    # Firm Date range filter (firm_date_from / firm_date_to): by the Firm Date shown (a combined order's own).
    def filter_by_firm_date(scope)
      from = iso_date(params[:firm_date_from])
      to = iso_date(params[:firm_date_to])
      return scope unless from || to

      firm = firm_date_sql
      scope = scope.where("#{firm} >= ?", from) if from
      scope = scope.where("#{firm} <= ?", to) if to
      scope
    end

    # Combined filter (combined=yes,no): the rows of combined orders, or the others.
    def filter_by_combined(scope)
      values = multi_param(:combined, %w[yes no])
      return scope if values.empty? || values.size == 2

      ids = @combined_keys.keys
      return values == [ "yes" ] ? scope.none : scope if ids.empty?

      condition = scope.sanitize_sql_array([ "NOT order_rows.manual AND order_rows.id IN (?)", ids ])
      values == [ "yes" ] ? scope.where(condition) : scope.where.not(condition)
    end

    # Vendor PO filter (po=none,generated): orders with a Qty and no PO generated yet, or with at least one PO.
    # Vendor PO: "none" (a Qty and no PO yet: PO to generate), "generated" (has a PO), "no_qty" (no Qty and no PO:
    # nothing to order). Every order is in exactly one of them.
    def filter_by_po(scope)
      values = multi_param(:po, %w[none generated no_qty])
      return scope if values.empty? || values.size == 3

      key = order_key_sql
      placed = "EXISTS (SELECT 1 FROM vendor_order_placements p WHERE p.order_key = #{key})"
      conditions = { "none" => "NOT #{placed} AND order_rows.qty > 0", "generated" => placed,
                     "no_qty" => "NOT #{placed} AND (order_rows.qty IS NULL OR order_rows.qty <= 0)" }
      scope.where(values.map { |value| "(#{conditions.fetch(value)})" }.join(" OR "))
    end

    def iso_date(value)
      Date.iso8601(value.to_s) if value.present?
    rescue Date::Error
      nil
    end

    # Also by Part Description (the file's Description column, else the product's) and invoice number (an uploaded SASH
    # India or SASH Inc invoice of the row, or of a Dispatched mark: its invoice, or one of its invoices sent for the row,
    # as the SASH India Invoice column shows).
    def search(scope, term)
      return scope if term.empty?
      pattern = "%#{OrderSnapshotRow.sanitize_sql_like(term)}%"
      conditions = SEARCH_COLUMNS.map { |c| "#{c} ILIKE :t" }
      conditions << "order_rows.source_data ->> 'Description' ILIKE :t"
      conditions << "EXISTS (SELECT 1 FROM products p WHERE p.part_number = order_rows.part_number AND p.description ILIKE :t)"
      manual_ids, row_ids = invoice_rows(scope, term)
      conditions << "(order_rows.manual AND order_rows.id IN (:manual_ids))" if manual_ids.any?
      conditions << "(NOT order_rows.manual AND order_rows.id IN (:row_ids))" if row_ids.any?
      scope.where(conditions.join(" OR "), t: pattern, manual_ids: manual_ids, row_ids: row_ids)
    end

    # The rows of `scope` (the dataset) with a SASH India invoice containing `term` (see #invoice_keys), as [manual
    # order ids, imported row ids]. Looked up once: the key SQL hashes every row, and the search runs twice (count, page).
    def invoice_rows(scope, term)
      mark_keys, line_keys = invoice_keys(term)
      conditions = []
      conditions << "#{order_key_sql} IN (:mark_keys)" if mark_keys.any?
      conditions << "#{own_key_sql} IN (:line_keys)" if line_keys.any?
      return [ [], [] ] if conditions.empty?

      rows = scope.unscope(:order).where(conditions.join(" OR "), mark_keys: mark_keys, line_keys: line_keys)
                  .pluck(Arel.sql("order_rows.manual"), Arel.sql("order_rows.id"))
      manual, imported = rows.partition(&:first)
      [ manual.map(&:last).uniq, imported.map(&:last).uniq ]
    end

    # Order keys of the active Dispatched marks whose SASH India invoice contains `term`: [keys of marks with one
    # invoice for all their rows (placement keys), keys of the rows an invoice was sent for (their own keys: also the rows
    # of uploaded invoices whose number contains `term`)].
    def invoice_keys(term)
      needle = term.downcase
      marks = OrderDelivery.active.where(kind: "dispatched")
                           .where("invoice_number ILIKE :t OR invoice_lines::text ILIKE :t", t: "%#{OrderDelivery.sanitize_sql_like(term)}%")
                           .pluck(:order_key, :invoice_number, :invoice_lines)
      mark_keys = marks.filter_map { |key, number, lines| key if lines.blank? && number.to_s.downcase.include?(needle) }
      line_keys = marks.flat_map { |_, _, lines| lines.select { |line| line["invoice"].to_s.downcase.include?(needle) }.map { |line| line["order_key"] } }
      line_keys += InvoiceAllocation.active.where("invoices.invoice_number ILIKE ?", "%#{Invoice.sanitize_sql_like(term)}%").distinct.pluck(:order_key)
      [ mark_keys.uniq, line_keys.compact.uniq ]
    end

    # A listed row's own order key in SQL (not its combined order's): by id for manual orders.
    def own_key_sql
      "(CASE WHEN order_rows.manual THEN encode(sha256(convert_to('manual' || chr(31) || order_rows.id::text, 'UTF8')), 'hex') " \
        "ELSE #{Orders::FirmDates.key_sql('order_rows')} END)"
    end

    # Firm Date of each listed row (by position): the day the order (PO + Part + Type + PO Line + Ship Date) first came
    # as a Firm / Order row, i.e. the first upload of its business with it (a manual order: the day it was added). The
    # Effective Firm Date (firm_date) is the one ageing counts from. Forecast rows have none.
    def came_firm_dates(rows)
      zone = Time.find_zone!(AppConfig.ageing_time_zone)
      imported = rows.reject { |row| row[:manual] || !%w[Firm Order].include?(row.order_type) }
      first = {}
      if imported.any?
        completed = UploadBatch.completed.where(business: businesses).pluck(:id, :completed_at).to_h
        tuples = imported.map { |row| [ row.group_key, row.po_line_number, row.ship_date ] }.uniq
        values = tuples.each_with_index.map { |(g, l, d), i| OrderRow.sanitize_sql_array([ "(?, ?, ?, ?::date)", i, g, l, d ]) }.join(", ")
        # The uploads of each order, looked up order by order from the (group_key, po_line_number, ship_date,
        # upload_batch_id) index, so each reads only its own rows however many uploads there are (uploads of other
        # businesses, or not completed, are left out below).
        uploads = OrderRow.where("order_rows.group_key = orders.group_key AND order_rows.po_line_number = orders.po_line_number " \
                                 "AND order_rows.ship_date = orders.ship_date")
                          .select("array_agg(DISTINCT order_rows.upload_batch_id)")
        first = OrderRow.from("(VALUES #{values}) AS orders (i, group_key, po_line_number, ship_date)")
                        .pluck(Arel.sql("orders.i"), Arel.sql("(#{uploads.to_sql})"))
                        .to_h { |i, ids| [ tuples[i], ids.to_a.filter_map { |id| completed[id] }.min ] }
      end
      rows.map do |row|
        next row.created_at.in_time_zone(zone).to_date.iso8601 if row[:manual]

        at = first[[ row.group_key, row.po_line_number, row.ship_date ]]
        at&.in_time_zone(zone)&.to_date&.iso8601
      end
    end
  end
end
