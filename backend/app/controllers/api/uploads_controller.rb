module Api
  class UploadsController < ApplicationController
    rate_limit to: 30, within: 1.hour, only: :create, store: RATE_LIMIT_STORE, by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many uploads in a short time. Try again later.", :too_many_requests }

    CHANGE_SORTS = {
      "ship_date" => [ :ship_date, :po_number, :po_line_number ],
      "po" => [ :po_number, :po_line_number, :ship_date ],
      "part" => [ :part_number, :ship_date ],
      "difference" => Arel.sql("abs(difference) DESC, ship_date ASC")
    }.freeze

    UPLOAD_SORTS = {
      "uploaded_at" => "upload_batches.created_at", "original_filename" => "upload_batches.original_filename",
      "uploaded_by" => "users.name", "row_count" => "upload_batches.row_count",
      "changes" => "(upload_batches.increase_count + upload_batches.decrease_count)", "status" => "upload_batches.status"
    }.freeze

    def index
      scope = UploadBatch.joins(:uploaded_by).includes(:uploaded_by)
      scope = scope.where(status: params[:status]) if UploadBatch::STATUSES.include?(params[:status])
      scope = search_uploads(scope, params[:q].to_s.strip.first(100)) if params[:q].present?
      scope, sort, direction = apply_sort(scope, UPLOAD_SORTS, default: "uploaded_at", default_direction: :desc)
      batches, meta = paginate(scope)
      meta = meta.merge(sort: sort, direction: direction)
      render json: { data: batches.map { |b| Serializers.upload_batch(b) }, meta: meta }
    end

    # Matches the file name or uploader name.
    def search_uploads(scope, query)
      term = "%#{UploadBatch.sanitize_sql_like(query)}%"
      scope.where("upload_batches.original_filename ILIKE :t OR users.name ILIKE :t", t: term)
    end

    def show
      batch = UploadBatch.includes(:uploaded_by, :previous_upload_batch, :notification, file_attachment: :blob).find(params[:id])
      render json: { data: Serializers.upload_batch(batch, detail: true) }
    end

    def create
      batch = Uploads::Intake.call(file: params.require(:file), user: current_user)
      audit("upload.received", subject: batch, filename: batch.original_filename, sha256: batch.file_sha256)
      render json: { data: Serializers.upload_batch(batch, detail: true) }, status: :accepted
    rescue Uploads::Intake::Rejected => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    def changes
      batch = UploadBatch.find(params[:id])
      scope = batch.quantity_changes
      scope = scope.where(direction: params[:direction]) if QuantityChange::DIRECTIONS.include?(params[:direction])
      scope = scope.where(order_type: params[:type]) if OrderRows::Normalizer::ORDER_TYPES.include?(params[:type])
      scope = filter_by_age(scope)
      if params[:q].present?
        term = "%#{QuantityChange.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("po_number ILIKE :t OR part_number ILIKE :t OR commodity_type ILIKE :t", t: term)
      end
      scope = scope.order(CHANGE_SORTS.fetch(params[:sort].to_s, CHANGE_SORTS["ship_date"])).order(:id)

      changes, meta = paginate(scope)
      render json: { data: changes.map { |c| Serializers.quantity_change(c) }, meta: meta }
    end

    # Uploaded-rows sort keys => fixed SQL (whitelist). "po" and "part" kept for older links.
    ROW_SORTS = {
      "excel_row" => "order_snapshot_rows.source_row_numbers[1]", "type" => "order_snapshot_rows.order_type",
      "po" => "order_snapshot_rows.po_number", "part" => "order_snapshot_rows.part_number",
      "part_number" => "order_snapshot_rows.part_number", "commodity_type" => "order_snapshot_rows.commodity_type",
      "ship_date" => "order_snapshot_rows.ship_date", "ship_to" => "order_snapshot_rows.ship_to_location",
      "qty" => "order_snapshot_rows.qty", "previous_qty" => "order_snapshot_rows.previous_qty",
      "effective_qty" => "order_snapshot_rows.effective_qty"
    }.freeze
    QUANTITY_SOURCES = %w[qty previous_qty unknown].freeze

    # The stored order rows of one version (what the uploaded workbook contained after normalization).
    def rows
      batch = UploadBatch.find(params[:id])
      scope = batch.order_snapshot_rows
      scope = scope.where(order_type: params[:type]) if OrderRows::Normalizer::ORDER_TYPES.include?(params[:type])
      scope = scope.where(quantity_source: params[:quantity]) if QUANTITY_SOURCES.include?(params[:quantity])
      scope = scope.where(ship_to_location: params[:ship_to].to_s.upcase) if params[:ship_to].present?
      scope = filter_by_age(scope)
      if params[:q].present?
        term = "%#{OrderSnapshotRow.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("po_number ILIKE :t OR part_number ILIKE :t OR commodity_type ILIKE :t", t: term)
      end
      scope, sort, direction = apply_sort(scope, ROW_SORTS, default: "excel_row")

      rows, meta = paginate(scope)
      meta = meta.merge(sort: sort, direction: direction)
      render json: { data: rows.map { |r| Serializers.snapshot_row(r) }, meta: meta,
                     ship_to_locations: batch.order_snapshot_rows.distinct.order(:ship_to_location).pluck(:ship_to_location) }
    end

    # Row-level problems of a rejected upload, paged on the server. Optional `column` filter
    # ("_none" selects problems not tied to one column, such as duplicate rows).
    def problems
      errors = UploadBatch.find(params[:id]).validation_errors
      if params[:column].present?
        wanted = params[:column] == "_none" ? nil : params[:column]
        errors = errors.select { |e| e["column"] == wanted }
      end
      page, meta = paginate_array(errors)
      render json: { data: page, meta: meta }
    end

    def download
      batch = UploadBatch.find(params[:id])
      audit("upload.downloaded", subject: batch)
      send_data batch.file.download, filename: batch.original_filename,
                type: Uploads::Intake::XLSX_CONTENT_TYPE, disposition: "attachment"
    end

    def retry_notification
      notification = UploadBatch.find(params[:id]).notification
      return render_error("This upload has no notification.", :not_found) if notification.nil?
      return render_error("The notification was already sent.", :conflict) if notification.sent?

      Notifications::DeliverJob.perform_later(notification.id)
      audit("notification.retry_requested", subject: notification)
      render json: { data: Serializers.notification(notification) }, status: :accepted
    end
  end
end
