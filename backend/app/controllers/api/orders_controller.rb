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
      columns = source_columns(OrderRow.where(upload_batch_id: batch&.id))
      scope = filter(search(dataset, (params[:search].presence || params[:q]).to_s.strip.first(100)))
      scope, sort, direction = apply_sort(scope, sorts_for(columns), default: DEFAULT_SORT)
      # Manual orders are always listed first; each part keeps the chosen sort.
      scope = scope.reorder(Arel.sql("order_rows.manual DESC"), *scope.order_values)

      rows, meta = paginate(scope)
      ship_to_locations, commodity_types = facets(dataset)
      render json: {
        data: rows.map { |row| Serializers.order_row(row, source: true) },
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
    # (the clicked row included), ordered by PO Line Number then Ship Date, plus the product Description.
    def history
      return manual_history(ManualOrder.active.find(params[:id])) if params[:manual] == "1"

      row = OrderRow.find(params[:id])
      rows = OrderRow.where(upload_batch_id: row.upload_batch_id, group_key: row.group_key)
                     .order(:po_line_number, :ship_date, :source_row_number).limit(1_000)
      render json: {
        data: rows.map { |r| Serializers.order_row(r, source: true) },
        headers: row.source_columns.presence || row.source_data.keys,
        group: { po_number: row.po_number, part_number: row.part_number, order_type: row.order_type,
                 description: Product.find_by(part_number: row.part_number)&.description }
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

    # [Ship To Locations, Commodity Types] present in the dataset, sorted, from one scan.
    def facets(dataset)
      dataset.pick(
        Arel.sql("COALESCE(array_agg(DISTINCT order_rows.ship_to_location ORDER BY order_rows.ship_to_location), '{}')"),
        Arel.sql("COALESCE(array_agg(DISTINCT order_rows.commodity_type ORDER BY order_rows.commodity_type) " \
                 "FILTER (WHERE order_rows.commodity_type IS NOT NULL), '{}')")
      )
    end

    # A manual order has no other rows: its history is itself.
    def manual_history(order)
      render json: {
        data: [ Serializers.order_row(order, source: true) ],
        headers: order.source_columns,
        group: { po_number: order.po_number, part_number: order.part_number, order_type: order.order_type,
                 description: Product.find_by(part_number: order.part_number)&.description }
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

    # The upload's rows, plus (current view) the manual orders, as one `order_rows` relation so the
    # search, filters, sorting and pagination below apply to both. Each row has `manual` (true/false).
    def dataset(batch)
      imported = OrderRow.where(upload_batch_id: batch&.id)
                         .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count, "false AS manual")
      return OrderRow.from("(#{imported.to_sql}) AS order_rows") unless current_view?

      manual = ManualOrder.active.select(*SHARED_COLUMNS, "NULL::bigint AS upload_batch_id", "NULL::integer AS source_row_number",
                                         "true AS current", "1 AS group_row_count", "true AS manual")
      OrderRow.from("(#{imported.to_sql} UNION ALL #{manual.to_sql}) AS order_rows")
    end

    # Headers of the upload in file order; the 47 manual order columns when there is no upload yet.
    def source_columns(rows)
      headers = rows.where.not(source_columns: nil).pick(:source_columns) || ManualOrder::HEADERS
      headers.map { |h| { key: h.parameterize(separator: "_"), label: h } }
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
