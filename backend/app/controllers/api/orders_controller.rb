module Api
  # The latest successful order dataset. Search, sorting and pagination all run in PostgreSQL.
  class OrdersController < ApplicationController
    SEARCH_COLUMNS = %w[po_number po_line_number part_number commodity_type order_type ship_to_location
                        supplier_part_number plant_code].freeze

    # Public sort key => fixed column. Only these can reach ORDER BY.
    SORTS = {
      "type" => "order_snapshot_rows.order_type", "due_date" => "order_snapshot_rows.due_date",
      "ship_date" => "order_snapshot_rows.ship_date", "unit" => "order_snapshot_rows.unit",
      "plant_code" => "order_snapshot_rows.plant_code", "po_number" => "order_snapshot_rows.po_number",
      "po_line_number" => "order_snapshot_rows.po_line_number",
      "part_number" => "order_snapshot_rows.part_number",
      "commodity_type" => "order_snapshot_rows.commodity_type", "qty" => "order_snapshot_rows.qty",
      "previous_qty" => "order_snapshot_rows.previous_qty",
      "last_asn_qty" => "order_snapshot_rows.last_asn_qty",
      "last_asn_date" => "order_snapshot_rows.last_asn_date",
      "last_receipt_qty" => "order_snapshot_rows.last_receipt_qty",
      "last_receipt_date" => "order_snapshot_rows.last_receipt_date",
      "last_packing_list_number" => "order_snapshot_rows.last_packing_list_number",
      "crossdock_location" => "order_snapshot_rows.crossdock_location",
      "ship_to_location" => "order_snapshot_rows.ship_to_location",
      "dock_number" => "order_snapshot_rows.dock_number",
      "supplier_part_number" => "order_snapshot_rows.supplier_part_number",
      "last_released_date" => "order_snapshot_rows.last_released_date",
      "last_updated_date" => "order_snapshot_rows.last_updated_date"
    }.freeze
    DEFAULT_SORT = "ship_date".freeze

    def index
      latest = UploadBatch.latest_completed
      return render(json: { data: [], meta: pagination_meta(0).last, source: nil }) if latest.nil?

      scope = search(latest.order_snapshot_rows, (params[:search].presence || params[:q]).to_s.strip.first(100))
      scope, sort, direction = apply_sort(scope, SORTS, default: DEFAULT_SORT)

      rows, meta = paginate(scope)
      render json: {
        data: rows.map { |row| Serializers.order_row(row) },
        meta: meta.merge(sort: sort, direction: direction),
        source: { uploaded_at: latest.completed_at, original_filename: latest.original_filename, upload_id: latest.id }
      }
    end

    private

    def search(scope, term)
      return scope if term.empty?
      pattern = "%#{OrderSnapshotRow.sanitize_sql_like(term)}%"
      scope.where(SEARCH_COLUMNS.map { |c| "#{c} ILIKE :t" }.join(" OR "), t: pattern)
    end
  end
end
