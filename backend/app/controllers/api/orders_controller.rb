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
      @moq_parts = Orders::MoqBalance.needing(batches.map(&:id))
      scope = filter(search(dataset, (params[:search].presence || params[:q]).to_s.strip.first(100)), combined)
      scope, sort, direction = apply_sort(scope, sorts_for(columns).merge("firm_date" => firm_date_sql), default: DEFAULT_SORT)
      # Manual orders are always listed first; each part keeps the chosen sort.
      scope = scope.reorder(Arel.sql("order_rows.manual DESC"), *scope.order_values)

      rows, meta = if filtered?
        paginate(scope)
      else
        # Stored rows of the upload (row_count is the number after merging identical rows, not what is listed).
        total = OrderRow.where(upload_batch_id: batches.map(&:id)).count +
                (current_view? ? manual_orders.count + kept_rows(batches).count : 0)
        paginate_with_known_total(scope, total)
      end

      ship_to_locations, commodity_types = facets(batches)
      ordered = ordered_by_key(rows)
      order_placed = VendorOrderPlacement.order_placed_keys(ordered.keys)
      deliveries = deliveries_by_key(rows)
      # A combined order's rows show the combined order's Firm Date (the day it reached the MOQ).
      # (By position: an imported row and a manual order can share an id.)
      firm_keys = rows.map { |row| firm_key(row) }
      firm_dates = Orders::FirmDates.for_keys(firm_keys)
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
                                                         **row_invoice(deliveries.dig(key, "dispatched"), row),
                                                         firm_date: firm_dates[firm_keys[i]], business: row[:business],
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
    # yet delivered to Deere (outbound); po_pending: open ones with a Qty and no PO generated yet; below_moq: parts that
    # need MOQ (Orders::MoqBalance: Firm Qty less PO issued, still to order, below the MOQ); aged: open ones 90+ days
    # since their order's Firm Date (age group red, on the browser's `today`).
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
      open = rows.reject { |_, key, *| delivered.include?(key) }
      placed = VendorOrderPlacement.where(order_key: open.map { |r| r[1] }).distinct.pluck(:order_key).to_set
      # The orders of the open rows (a combined order's first row for each of its rows).
      open_orders = open.reject(&:last).map { |id, *| anchor_of.fetch(id, id) }
      aged = Ageing::Rules.in_bands(OrderRow.where(id: open_orders.uniq), [ "red" ], request_today,
                                    combined_ids: combined.groups.values.select(&:combined?).map(&:anchor_id)).pluck(:id).to_set
      # Delivery tabs, counted on the same rows (a combined order's status for each of its rows): in transit (dispatched
      # from Faridabad, not yet at the US warehouse) and fulfilled (delivered to Deere).
      statuses = dataset(UploadBatch.latest_for(current_business)).group(Arel.sql(status_sql)).count
      render json: {
        open: open.size,
        po_pending: open.count { |_, key, qty, _| qty.to_d.positive? && !placed.include?(key) },
        # The rest of the open orders: with a vendor PO, or without a Qty (nothing to order).
        po_generated: open.count { |_, key, *| placed.include?(key) },
        no_qty: open.count { |_, key, qty, _| !qty.to_d.positive? && !placed.include?(key) },
        below_moq: Orders::MoqBalance.needing(batch_ids).values.sum(&:size),
        aged: open_orders.count { |id| aged.include?(id) },
        in_transit: statuses["dispatched"].to_i,
        fulfilled: statuses["outbound"].to_i
      }
    end

    # Order detail of one row: every row of the same upload with the same PO Number + Part Number + Type
    # (the clicked row included), ordered by PO Line Number then Ship Date, plus the product Description, each
    # row's Firm Date and the combined orders among them (`combined`; `candidate_ids`: orders an admin can add).
    def history
      return manual_history(ManualOrder.active.find(params[:id])) if params[:manual] == "1"

      row = OrderRow.find(params[:id])
      rows = OrderRow.where(upload_batch_id: row.upload_batch_id, group_key: row.group_key)
                     .order(:po_line_number, :ship_date, :source_row_number).limit(1_000)
      firm_dates = Orders::FirmDates.for_keys(rows.map { |r| VendorOrderPlacement.order_key(r) })
      combined = Orders::Combiner.call(row.upload_batch_id)
      groups = combined.groups.values.select { |g| Orders::Merges.shown?(g) && g.members.first.group_key == row.group_key }
      render json: {
        data: rows.map { |r| Serializers.order_row(r, source: true).merge(firm_date: firm_dates[VendorOrderPlacement.order_key(r)]) },
        headers: row.source_columns.presence || row.source_data.keys,
        group: group_info(row),
        combined: groups.map { |g| schedule_group(g, combined) }
      }
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

    STATUSES = %w[none received dispatched inbound outbound].freeze

    # Current status of a listed row (its furthest status mark), or 'none'.
    CURRENT_STATUS_SQL = <<~SQL.squish.freeze
      COALESCE((SELECT d.kind FROM order_deliveries d
                WHERE d.removed_at IS NULL
                  AND ((order_rows.manual AND d.manual_order_id = order_rows.id)
                       OR (NOT order_rows.manual AND d.manual_order_id IS NULL AND d.po_number = order_rows.po_number
                           AND d.part_number = order_rows.part_number AND d.order_type = order_rows.order_type
                           AND d.po_line_number = order_rows.po_line_number AND d.ship_date = order_rows.ship_date))
                ORDER BY array_position(ARRAY['received', 'dispatched', 'inbound', 'outbound']::varchar[], d.kind) DESC
                LIMIT 1), 'none')
    SQL

    # Status filter (status=none,received,…); without it, fulfilled orders (outbound) are left out.
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

    # The current status of a listed row in SQL (CURRENT_STATUS_SQL): the combined order's for its rows.
    def status_sql
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
    # A Dispatched mark with its invoices one by one (invoice_lines, from the dispatched orders list): those sent for
    # this row (a combined order's rows each show their own), the one with the row's Qty shown (Deere's Qty is what is
    # still open, so an earlier part shipment has another Qty), else the latest. Otherwise the mark's invoice number.
    def row_invoice(dispatched, row)
      return { dispatch_invoice: nil, dispatch_invoices: [] } unless dispatched
      if dispatched[:invoice_lines].blank?
        return { dispatch_invoice: dispatched[:invoice_number], dispatch_invoices: [ dispatched[:invoice_number] ].compact }
      end

      own = row[:manual] ? placement_key(row) : VendorOrderPlacement.order_key(row)
      lines = dispatched[:invoice_lines].select { |line| line["order_key"] == own }.sort_by { |line| line["date"].to_s }
      shown = lines.find { |line| row.qty && line["qty"].present? && BigDecimal(line["qty"]) == row.qty } || lines.last
      { dispatch_invoice: shown&.dig("invoice"),
        dispatch_invoices: lines.map { |line| "#{line['invoice']} (#{line['date']}#{", Qty #{line['qty']}" if line['qty']})" }.uniq }
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
        group: group_info(order)
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
      imported = OrderRow.where(upload_batch_id: batches.map(&:id))
                         .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                                 "false AS manual", "false AS kept", BUSINESS_SQL)
      return OrderRow.from("(#{imported.to_sql}) AS order_rows") unless current_view?

      manual = manual_orders.select(*SHARED_COLUMNS, "NULL::bigint AS upload_batch_id", "NULL::integer AS source_row_number",
                                    "true AS current", "1 AS group_row_count", "true AS manual", "false AS kept", "business")
      kept = OrderRow.where(id: kept_rows(batches).select(:id))
                     .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                             "false AS manual", "true AS kept", BUSINESS_SQL)
      OrderRow.from("(#{imported.to_sql} UNION ALL #{manual.to_sql} UNION ALL #{kept.to_sql}) AS order_rows")
    end

    # Orders of the view's businesses placed with vendors or with an active status mark that are no longer in their
    # business's latest upload: like manual orders they stay on the Orders page. One row per order (PO + Part + Type +
    # PO Line + Ship Date), its last version.
    def kept_rows(batches)
      ids = batches.map { |b| Integer(b.id) }.presence || [ 0 ]
      names = businesses.map { |b| OrderRow.connection.quote(b) }.join(",")
      OrderRow.from(<<~SQL.squish)
        (SELECT DISTINCT ON (r.group_key, r.po_line_number, r.ship_date) r.id
         FROM order_rows r JOIN upload_batches b ON b.id = r.upload_batch_id AND b.business IN (#{names})
         WHERE r.upload_batch_id NOT IN (#{ids.join(',')})
           AND (EXISTS (SELECT 1 FROM order_deliveries d WHERE d.order_row_id = r.id AND d.removed_at IS NULL)
                OR EXISTS (SELECT 1 FROM vendor_order_placements p WHERE p.order_row_id = r.id))
           AND NOT EXISTS (SELECT 1 FROM order_rows n WHERE n.upload_batch_id IN (#{ids.join(',')})
                           AND n.group_key = r.group_key AND n.po_line_number = r.po_line_number AND n.ship_date = r.ship_date)
         ORDER BY r.group_key, r.po_line_number, r.ship_date, r.upload_batch_id DESC) AS order_rows
      SQL
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
      OrderDelivery.active.where(kind: "outbound").exists? || params[:status].present? ||
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

    def search(scope, term)
      return scope if term.empty?
      pattern = "%#{OrderSnapshotRow.sanitize_sql_like(term)}%"
      scope.where(SEARCH_COLUMNS.map { |c| "#{c} ILIKE :t" }.join(" OR "), t: pattern)
    end
  end
end
