module Api
  # The latest successful order dataset. Search, sorting and pagination all run in PostgreSQL.
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

    def index
      latest = UploadBatch.latest_completed
      return render(json: { data: [], meta: pagination_meta(0).last, source: nil }) if latest.nil?

      # Every imported row of the latest upload (not only the current row of each PO + Part + Type).
      dataset = latest.order_rows
      columns = source_columns(dataset)
      scope = filter(search(dataset, (params[:search].presence || params[:q]).to_s.strip.first(100)))
      scope, sort, direction = apply_sort(scope, sorts_for(columns), default: DEFAULT_SORT)

      rows, meta = paginate(scope)
      render json: {
        data: rows.map { |row| Serializers.order_row(row, source: true) },
        meta: meta.merge(sort: sort, direction: direction),
        # Every Excel column of the upload, in file order; `key` is the sort key.
        columns: columns,
        source: { uploaded_at: latest.completed_at, original_filename: latest.original_filename, upload_id: latest.id },
        # Values present in the current data, for the filter panel.
        facets: {
          ship_to_locations: dataset.distinct.order(:ship_to_location).pluck(:ship_to_location),
          commodity_types: dataset.where.not(commodity_type: nil).distinct.order(:commodity_type).pluck(:commodity_type)
        }
      }
    end

    # Order detail of one row: every row of the same upload with the same PO Number + Part Number + Type
    # (the clicked row included), ordered by PO Line Number then Ship Date, plus the product Description.
    def history
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

    # Part Numbers ordered under one PO Number (latest upload).
    def by_po
      render json: { data: related(:po_number, params.require(:po).to_s, :part_number) }
    end

    # PO Numbers containing one Part Number (latest upload).
    def by_part
      render json: { data: related(:part_number, OrderRows::Normalizer.part_number(params.require(:part).to_s), :po_number) }
    end

    private

    def source_columns(dataset)
      headers = dataset.where.not(source_columns: nil).pick(:source_columns) || []
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
      latest = UploadBatch.latest_completed
      return [] unless latest

      latest.order_rows.where(column => value).group(other).order(other)
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
