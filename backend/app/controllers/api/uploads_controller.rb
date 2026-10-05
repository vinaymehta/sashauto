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

    # Every completed upload, newest first, to choose which upload's order data the Orders page shows.
    def history
      batches = UploadBatch.completed.includes(:uploaded_by).order(completed_at: :desc, id: :desc)
      render json: { data: batches.map { |b| { id: b.id, original_filename: b.original_filename, uploaded_at: b.created_at,
                                               completed_at: b.completed_at, uploaded_by: b.uploaded_by&.name } } }
    end

    # Matches the file name or uploader name.
    def search_uploads(scope, query)
      term = "%#{UploadBatch.sanitize_sql_like(query)}%"
      scope.where("upload_batches.original_filename ILIKE :t OR users.name ILIKE :t", t: term)
    end

    def show
      batch = UploadBatch.includes(:uploaded_by, :previous_upload_batch, :notifications, :ageing_digests, file_attachment: :blob).find(params[:id])
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
      scope = detections(UploadBatch.find(params[:id]), QuantityChange)
      directions = multi_param(:direction, QuantityChange::DIRECTIONS)
      types = multi_param(:type, OrderRows::Normalizer::ORDER_TYPES)
      scope = scope.where(direction: directions) if directions.any?
      scope = scope.where(order_type: types) if types.any?
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
      types = multi_param(:type, OrderRows::Normalizer::ORDER_TYPES)
      sources = multi_param(:quantity, QUANTITY_SOURCES)
      ship_tos = multi_param(:ship_to).map(&:upcase)
      scope = scope.where(order_type: types) if types.any?
      scope = scope.where(quantity_source: sources) if sources.any?
      scope = scope.where(ship_to_location: ship_tos) if ship_tos.any?
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

    # Ship To Address changes detected for this upload (current rows only), paged on the server.
    def address_changes
      scope = detections(UploadBatch.find(params[:id]), AddressChange).order(:po_number, :part_number, :ship_date, :id)
      if params[:q].present?
        term = "%#{AddressChange.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("po_number ILIKE :t OR part_number ILIKE :t OR old_address ILIKE :t OR new_address ILIKE :t", t: term)
      end
      changes, meta = paginate(scope)
      render json: { data: changes.map { |c| Serializers.address_change(c) }, meta: meta }
    end

    # MOQ alerts for this upload (current rows with Qty below the Part Number's MOQ), paged on the server.
    def moq_alerts
      scope = detections(UploadBatch.find(params[:id]), MoqAlert).order(:po_number, :part_number, :order_type, :id)
      if params[:q].present?
        term = "%#{MoqAlert.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("po_number ILIKE :t OR part_number ILIKE :t", t: term)
      end
      alerts, meta = paginate(scope)
      render json: { data: alerts.map { |a| Serializers.moq_alert(a) }, meta: meta }
    end

    # Row-level problems of a rejected upload, paged on the server. Optional `column` filter
    # ("_none" selects problems not tied to one column, such as duplicate rows).
    def problems
      errors = UploadBatch.find(params[:id]).validation_errors
      columns = multi_param(:column)
      if columns.any?
        wanted = columns.map { |c| c == "_none" ? nil : c }
        errors = errors.select { |e| wanted.include?(e["column"]) }
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

    # Re-queues every unsent email of this upload (change alerts and the ageing digest).
    def retry_notification
      batch = UploadBatch.find(params[:id])
      notifications = batch.notifications.undelivered.to_a
      digests = batch.ageing_digests.where(status: %w[pending failed]).to_a
      return render_error("This upload has no unsent email.", :conflict) if notifications.empty? && digests.empty?

      notifications.each { |n| Notifications::DeliverJob.perform_later(n.id) }
      digests.each { |d| Ageing::DeliverDigestJob.perform_later(d.id) }
      audit("notification.retry_requested", subject: batch, notifications: notifications.map(&:id), ageing_digests: digests.map(&:id))
      render json: { data: Serializers.upload_emails(batch.reload) }, status: :accepted
    end

    private

    # Detection records of `model` for the upload. With `manual=1` on the latest upload, also those from
    # manual order creates/edits made since it was uploaded (the current order data).
    def detections(batch, model)
      scope = model.where(upload_batch_id: batch.id)
      return scope unless params[:manual] == "1" && batch == UploadBatch.latest_completed

      scope.or(ManualOrder.detections(model, since: batch.completed_at))
    end
  end
end
