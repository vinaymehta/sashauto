module Api
  # The latest successful order dataset plus the manual orders, or (`upload_id`) any earlier upload's
  # rows exactly as imported. Search, sorting and pagination all run in PostgreSQL.
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
    DEFAULT_SORT = "ship_date".freeze

    # Columns of order_rows that manual_orders has too (same names and types).
    SHARED_COLUMNS = %w[id group_key po_number part_number order_type ship_date po_line_number ship_to_location
                        commodity_type qty previous_qty effective_qty quantity_source due_date unit plant_code
                        last_asn_qty last_asn_date last_receipt_qty last_receipt_date last_packing_list_number
                        crossdock_location dock_number supplier_part_number last_released_date last_updated_date
                        source_data source_columns created_at].freeze

    def index
      batch = selected_batch
      return render(json: { data: [], meta: pagination_meta(0).last, source: nil }) if batch.nil? && !ManualOrder.active.exists?

      # Every imported row of the upload (not only the current row of each PO + Part + Type).
      dataset = dataset(batch)
      columns = source_columns(batch)
      scope = filter(search(dataset, (params[:search].presence || params[:q]).to_s.strip.first(100)))
      # Orders inside a combined order (Orders::Combiner) are listed under its first order, not on their own.
      combined = Orders::Combiner.call(batch&.id)
      scope = scope.where("order_rows.manual OR order_rows.id NOT IN (?)", combined.hidden.to_a) if combined.hidden.any?
      scope, sort, direction = apply_sort(scope, sorts_for(columns), default: DEFAULT_SORT)
      # Manual orders are always listed first; each part keeps the chosen sort.
      scope = scope.reorder(Arel.sql("order_rows.manual DESC"), *scope.order_values)

      rows, meta = if filtered? || combined.hidden.any?
        paginate(scope)
      else
        # Stored rows of the upload (row_count is the number after merging identical rows, not what is listed).
        total = OrderRow.where(upload_batch_id: batch&.id).count +
                (current_view? ? ManualOrder.active.count + kept_rows(batch).count : 0)
        paginate_with_known_total(scope, total)
      end

      ship_to_locations, commodity_types = facets(batch, dataset)
      ordered = ordered_by_key(rows)
      deliveries = deliveries_by_key(rows)
      firm_dates = Orders::FirmDates.for_keys(rows.map { |row| placement_key(row) })
      render json: {
        data: rows.map do |row|
          key = placement_key(row)
          Serializers.order_row(row, source: true).merge(placed: ordered.key?(key), ordered_qty: Serializers.qty(ordered[key]),
                                                         deliveries: deliveries.fetch(key, {}),
                                                         firm_date: firm_dates[key], **combined_info(row, combined))
        end,
        meta: meta.merge(sort: sort, direction: direction),
        # Every Excel column of the upload, in file order; `key` is the sort key.
        columns: columns,
        source: batch && { uploaded_at: batch.completed_at, original_filename: batch.original_filename, upload_id: batch.id,
                           latest: current_view? },
        # Values present in the current data, for the filter panel.
        facets: { ship_to_locations: ship_to_locations, commodity_types: commodity_types }
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
      return scope.where("#{CURRENT_STATUS_SQL} <> 'outbound'") if statuses.empty?

      scope.where("#{CURRENT_STATUS_SQL} IN (?)", statuses)
    end

    # For an imported row that starts a combined order: the combined Qty and its orders; below_moq when the order
    # (single or combined) is still below the part's MOQ.
    def combined_info(row, combined)
      return {} if row[:manual]

      group = combined.groups[row.id]
      info = { below_moq: combined.open.include?(row.id), moq: group && Serializers.qty(group.moq) }
      return info unless group&.combined?

      info.merge(combined: { total: Serializers.qty(group.total), moq: Serializers.qty(group.moq),
                             members: group.members.map do |m|
                               { id: m.id, po_line_number: m.po_line_number, ship_date: m.ship_date, qty: Serializers.qty(m.qty),
                                 manual: group.manual_ids.include?(m.id) }
                             end })
    end

    # Order details header of a row's PO Number + Part Number + Type: the part's Description and MOQ (sets, and pieces
    # for pack parts).
    def group_info(row)
      product = Product.find_by(part_number: row.part_number)
      { po_number: row.po_number, part_number: row.part_number, order_type: row.order_type, description: product&.description,
        moq: Serializers.qty(product && (product.moq_sets || product.moq)), moq_pcs: Serializers.qty(product&.moq),
        pack_size: product&.pack_size || 1 }
    end

    # A combined order in the Order details Schedule. PO generated (placed): its orders can no longer change.
    def schedule_group(group, combined)
      anchor = OrderRow.find(group.anchor_id)
      { anchor_id: group.anchor_id, member_ids: group.members.map(&:id), manual_ids: group.manual_ids, removed_ids: group.removed_ids,
        total: Serializers.qty(group.total), moq: Serializers.qty(group.moq), below_moq: group.below_moq?,
        placed: VendorOrderPlacement.exists?(order_key: VendorOrderPlacement.order_key(anchor)),
        candidate_ids: current_user.admin? ? Orders::Merges.candidates(anchor, combined).map(&:id) : [] }
    end

    # Placement key of a listed row (an imported row, or a manual order listed with `manual`).
    def placement_key(row)
      VendorOrderPlacement.order_key(row[:manual] ? ManualOrder.new(id: row.id) : row)
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

    # [Ship To Locations, Commodity Types] present in the dataset, sorted.
    # Upload batches are immutable, so batch facets are cached in memory.
    def facets(batch, dataset)
      batch_facets = if batch
        Rails.cache.fetch("order_rows_facets_batch_#{batch.id}") do
          OrderRow.where(upload_batch_id: batch.id).pick(
            Arel.sql("COALESCE(array_agg(DISTINCT order_rows.ship_to_location ORDER BY order_rows.ship_to_location), '{}')"),
            Arel.sql("COALESCE(array_agg(DISTINCT order_rows.commodity_type ORDER BY order_rows.commodity_type) " \
                     "FILTER (WHERE order_rows.commodity_type IS NOT NULL), '{}')")
          ) || [ [], [] ]
        end
      else
        [ [], [] ]
      end

      return batch_facets unless current_view? && ManualOrder.active.exists?

      manual_facets = ManualOrder.active.pick(
        Arel.sql("COALESCE(array_agg(DISTINCT ship_to_location ORDER BY ship_to_location), '{}')"),
        Arel.sql("COALESCE(array_agg(DISTINCT commodity_type ORDER BY commodity_type) FILTER (WHERE commodity_type IS NOT NULL), '{}')")
      ) || [ [], [] ]

      [
        (batch_facets[0] | manual_facets[0]).sort,
        (batch_facets[1] | manual_facets[1]).sort
      ]
    end

    # A manual order has no other rows: its history is itself.
    def manual_history(order)
      render json: {
        data: [ Serializers.order_row(order, source: true) ],
        headers: order.source_columns,
        group: group_info(order)
      }
    end

    # The upload whose rows are shown: `upload_id` (any completed upload), else the latest.
    def selected_batch
      return @selected_batch if defined?(@selected_batch)
      @latest = UploadBatch.latest_completed
      @selected_batch = params[:upload_id].present? ? UploadBatch.completed.find(params[:upload_id]) : @latest
    end

    # The current order data (latest upload) includes the manual orders; an earlier upload shows only its rows.
    def current_view?
      selected_batch == @latest
    end

    # The upload's rows, plus (current view) the manual orders and the kept rows (see #kept_rows), as one
    # `order_rows` relation so the search, filters, sorting and pagination below apply to all. Each row has
    # `manual` and `kept` (true/false).
    def dataset(batch)
      imported = OrderRow.where(upload_batch_id: batch&.id)
                         .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                                 "false AS manual", "false AS kept")
      return OrderRow.from("(#{imported.to_sql}) AS order_rows") unless current_view?

      manual = ManualOrder.active.select(*SHARED_COLUMNS, "NULL::bigint AS upload_batch_id", "NULL::integer AS source_row_number",
                                         "true AS current", "1 AS group_row_count", "true AS manual", "false AS kept")
      kept = OrderRow.where(id: kept_rows(batch).select(:id))
                     .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                             "false AS manual", "true AS kept")
      OrderRow.from("(#{imported.to_sql} UNION ALL #{manual.to_sql} UNION ALL #{kept.to_sql}) AS order_rows")
    end

    # Orders placed with vendors or with an active status mark that are no longer in the latest upload: like manual
    # orders they stay on the Orders page. One row per order (PO + Part + Type + PO Line + Ship Date), its last version.
    def kept_rows(batch)
      OrderRow.from(<<~SQL.squish)
        (SELECT DISTINCT ON (r.group_key, r.po_line_number, r.ship_date) r.id
         FROM order_rows r
         WHERE r.upload_batch_id <> #{Integer(batch&.id || 0)}
           AND (EXISTS (SELECT 1 FROM order_deliveries d WHERE d.order_row_id = r.id AND d.removed_at IS NULL)
                OR EXISTS (SELECT 1 FROM vendor_order_placements p WHERE p.order_row_id = r.id))
           AND NOT EXISTS (SELECT 1 FROM order_rows n WHERE n.upload_batch_id = #{Integer(batch&.id || 0)}
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
        params[:ship_date_from].present? || params[:ship_date_to].present? || params[:age].present?
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
      dataset(selected_batch).where(column => value).group(other).order(other)
            .pluck(other, Arel.sql("array_agg(DISTINCT order_type ORDER BY order_type)"), Arel.sql("COUNT(*)"))
            .map { |v, types, count| { value: v, types: types, rows: count } }
    end

    # Exact-match filters (several values each) plus an inclusive ship date range (ISO dates; invalid dates are ignored).
    def filter(scope)
      # Each filter accepts several values (comma-separated).
      types = multi_param(:type, OrderRows::Normalizer::ORDER_TYPES)
      ship_tos = multi_param(:ship_to)
      commodities = multi_param(:commodity_type)
      scope = scope.where(order_type: types) if types.any?
      scope = scope.where(ship_to_location: ship_tos) if ship_tos.any?
      scope = scope.where(commodity_type: commodities) if commodities.any?
      scope = filter_by_age(scope)
      scope = filter_by_status(scope)
      from = iso_date(params[:ship_date_from])
      to = iso_date(params[:ship_date_to])
      scope = scope.where(ship_date: from..) if from
      scope = scope.where(ship_date: ..to) if to
      scope
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
