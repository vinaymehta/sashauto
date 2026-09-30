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

      dataset = latest.order_snapshot_rows
      scope = filter(search(dataset, (params[:search].presence || params[:q]).to_s.strip.first(100)))
      scope, sort, direction = apply_sort(scope, SORTS, default: DEFAULT_SORT)

      rows, meta = paginate(scope)
      render json: {
        data: rows.map { |row| Serializers.order_row(row) },
        meta: meta.merge(sort: sort, direction: direction),
        source: { uploaded_at: latest.completed_at, original_filename: latest.original_filename, upload_id: latest.id },
        # Values present in the current data, for the filter panel.
        facets: {
          ship_to_locations: dataset.distinct.order(:ship_to_location).pluck(:ship_to_location),
          commodity_types: dataset.where.not(commodity_type: nil).distinct.order(:commodity_type).pluck(:commodity_type)
        }
      }
    end

    private

    # Exact-match filters plus an inclusive ship date range (ISO dates; invalid dates are ignored).
    def filter(scope)
      scope = scope.where(order_type: params[:type]) if OrderRows::Normalizer::ORDER_TYPES.include?(params[:type])
      scope = scope.where(ship_to_location: params[:ship_to].to_s) if params[:ship_to].present?
      scope = scope.where(commodity_type: params[:commodity_type].to_s) if params[:commodity_type].present?
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
