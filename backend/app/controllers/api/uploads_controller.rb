module Api
  class UploadsController < ApplicationController
    before_action :refuse_warehouse_manager, only: %i[create download compare]
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
      "changes" => "(upload_batches.increase_count + upload_batches.decrease_count + upload_batches.new_row_count + upload_batches.missing_row_count)", "status" => "upload_batches.status"
    }.freeze

    def index
      scope = UploadBatch.joins(:uploaded_by).includes(:uploaded_by).where(business: businesses)
      scope = scope.where(status: params[:status]) if UploadBatch::STATUSES.include?(params[:status])
      scope = search_uploads(scope, params[:q].to_s.strip.first(100)) if params[:q].present?
      scope, sort, direction = apply_sort(scope, UPLOAD_SORTS, default: "uploaded_at", default_direction: :desc)
      batches, meta = paginate(scope)
      meta = meta.merge(sort: sort, direction: direction)
      render json: { data: batches.map { |b| Serializers.upload_batch(b) }, meta: meta }
    end

    # Every completed upload of the view's businesses, newest first, to choose which upload's order data the Orders
    # page shows.
    def history
      batches = UploadBatch.completed.where(business: businesses).includes(:uploaded_by).order(completed_at: :desc, id: :desc)
      render json: { data: batches.map { |b| { id: b.id, original_filename: b.original_filename, uploaded_at: b.created_at,
                                               completed_at: b.completed_at, uploaded_by: b.uploaded_by&.name, business: b.business } } }
    end

    COMPARE_DIRECTIONS = %w[increase decrease added removed rescheduled changed].freeze

    # Comparison tab: two versions (`from`, `to`: uploads of one business) compared (Comparison::VersionDiff), paged on
    # the server. Filters: direction (multi), q (PO, Part Number or Part Description). meta.counts: lines per direction.
    def compare
      from = UploadBatch.completed.where(business: businesses).find(params.require(:from))
      to = UploadBatch.completed.where(business: businesses).find(params.require(:to))
      return render_error("Choose two versions of the same business.", :unprocessable_content) if from.business != to.business

      lines = Comparison::VersionDiff.call(from_batch_id: from.id, to_batch_id: to.id)
      row_ids = lines.flat_map { |l| [ l[:order_row_id], l[:previous_order_row_id] ] }.compact
      from_file = OrderRow.where(id: row_ids).pluck(:id, Arel.sql("order_rows.source_data ->> 'Description'")).to_h
      products = Product.where(part_number: lines.map { |l| l[:part_number] }.uniq).pluck(:part_number, :description).to_h
      lines.each do |l|
        file = from_file[l[:order_row_id]].presence || from_file[l[:previous_order_row_id]]
        l[:part_description] = file.to_s.squish.presence || products[l[:part_number]]
      end
      counts = lines.group_by { |l| l[:direction] }.transform_values(&:size)

      directions = multi_param(:direction, COMPARE_DIRECTIONS)
      lines = lines.select { |l| directions.include?(l[:direction]) } if directions.any?
      if (term = params[:q].to_s.strip.downcase.first(100)).present?
        lines = lines.select { |l| [ l[:po_number], l[:part_number], l[:part_description] ].any? { |v| v.to_s.downcase.include?(term) } }
      end
      page, meta = paginate_array(lines)
      render json: {
        data: page.map do |l|
          l.except(:order_row_id, :previous_order_row_id)
           .merge(old_qty: Serializers.qty(l[:old_qty]), new_qty: Serializers.qty(l[:new_qty]), difference: Serializers.qty(l[:difference]),
                  fields: l[:fields].map { |f| f.merge(old: f[:old].to_s.presence, new: f[:new].to_s.presence) })
        end,
        meta: meta.merge(counts: counts)
      }
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
      # The business is chosen with the file (or is the one shown in the top bar).
      business = Business::KEYS.include?(params[:business].to_s) ? params[:business].to_s : (businesses.one? ? businesses.first : nil)
      batch = Uploads::Intake.call(file: params.require(:file), user: current_user, business: business)
      audit("upload.received", subject: batch, filename: batch.original_filename, sha256: batch.file_sha256, business: batch.business)
      render json: { data: Serializers.upload_batch(batch, detail: true) }, status: :accepted
    rescue Uploads::Intake::Rejected => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    def changes
      scope = detections(UploadBatch.find(params[:id]), QuantityChange)
      directions = multi_param(:direction, QuantityChange::DIRECTIONS)
      types = multi_param(:type, OrderRows::Normalizer::ORDER_TYPES)
      # Reschedules (same Qty moved to another date) are listed only when asked for.
      scope = directions.any? ? scope.where(direction: directions) : scope.where.not(direction: "rescheduled")
      scope = scope.where(order_type: types) if types.any?
      scope = filter_by_age(scope)
      if params[:q].present?
        term = "%#{QuantityChange.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("po_number ILIKE :t OR part_number ILIKE :t OR commodity_type ILIKE :t", t: term)
      end
      net = scope.sum(:difference)
      rescheduled = scope.unscope(where: :direction).where(direction: "rescheduled").count
      scope = scope.order(CHANGE_SORTS.fetch(params[:sort].to_s, CHANGE_SORTS["ship_date"])).order(:id)

      changes, meta = paginate(scope)
      firm_dates = Orders::FirmDates.for_rows(changes)
      descriptions = part_descriptions(changes)
      render json: { data: changes.map { |c| Serializers.quantity_change(c).merge(firm_date: firm_dates[c.id], part_description: descriptions[c.id]) },
                     meta: meta.merge(net: Serializers.qty(net), rescheduled: rescheduled) }
    end

    CHANGE_KINDS = (QuantityChange::DIRECTIONS + %w[address]).freeze

    # Changes tab: every change of this upload in one list, each with its `direction`: Qty up / down (increase,
    # decrease), row added / removed, date moved (rescheduled: same Qty, another Ship Date) or "address" (Ship To
    # Address changed). Filters: direction (multi), type (multi), age, q; sort as `changes`. Address changes have no
    # PO line or Firm Date, so an age filter other than "Under 30 days or none" leaves them out. meta.counts: changes per direction (before the direction
    # filter); meta.net: the Qty difference of the listed quantity changes.
    def all_changes
      batch = UploadBatch.find(params[:id])
      directions = multi_param(:direction, CHANGE_KINDS)
      types = multi_param(:type, OrderRows::Normalizer::ORDER_TYPES)
      term = params[:q].to_s.strip.first(100).presence
      like = term && "%#{QuantityChange.sanitize_sql_like(term)}%"

      quantity = filter_by_age(detections(batch, QuantityChange))
      quantity = quantity.where(order_type: types) if types.any?
      if like
        parts = described_parts(batch, like)
        quantity = parts.reduce(quantity.where("po_number ILIKE :t OR part_number ILIKE :t OR commodity_type ILIKE :t", t: like)) { |s, p| s.or(quantity.where(part_number: p)) }
      end
      address = detections(batch, AddressChange)
      address = address.where(order_type: types) if types.any?
      address = parts.reduce(address.where("po_number ILIKE :t OR part_number ILIKE :t OR old_address ILIKE :t OR new_address ILIKE :t", t: like)) { |s, p| s.or(address.where(part_number: p)) } if like
      # Address changes have no Firm Date: they count as "Under 30 days or no Firm Date" only.
      address = address.none if (ages = multi_param(:age, AGE_GROUPS)).any? && ages.exclude?(Ageing::Rules::FRESH)

      counts = quantity.group(:direction).count.merge("address" => address.count)
      if directions.any?
        quantity = quantity.where(direction: directions & QuantityChange::DIRECTIONS)
        address = address.none unless directions.include?("address")
      end
      net = quantity.sum(:difference)

      changes = (quantity.to_a + address.to_a).sort_by(&all_changes_order(params[:sort].to_s))
      page, meta = paginate_array(changes)
      quantities = page.grep(QuantityChange)
      firm_dates = Orders::FirmDates.for_rows(quantities)
      # Type of the row in the previous upload: the change shows its new Type, so the Changes tab can show "Forecast → Firm".
      old_types = OrderRow.where(id: quantities.filter_map(&:previous_order_row_id)).pluck(:id, :order_type).to_h
      descriptions = part_descriptions(quantities).transform_keys { |id| [ QuantityChange, id ] }
                       .merge(part_descriptions(page.grep(AddressChange)).transform_keys { |id| [ AddressChange, id ] })
      render json: {
        data: page.map do |c|
          row = c.is_a?(QuantityChange) ? Serializers.quantity_change(c).merge(firm_date: firm_dates[c.id], previous_order_type: old_types[c.previous_order_row_id]) : Serializers.address_change(c).merge(direction: "address")
          row.merge(part_description: descriptions[[ c.class, c.id ]])
        end,
        meta: meta.merge(counts: counts, net: Serializers.qty(net))
      }
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
      firm_dates = Orders::FirmDates.for_rows(rows)
      render json: { data: rows.map { |r| Serializers.snapshot_row(r).merge(firm_date: firm_dates[r.id]) }, meta: meta,
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
      descriptions = part_descriptions(changes)
      render json: { data: changes.map { |c| Serializers.address_change(c).merge(part_description: descriptions[c.id]) }, meta: meta }
    end

    # MOQ alerts for this upload (parts whose Qty still to order is below their MOQ), paged on the server.
    def moq_alerts
      scope = detections(UploadBatch.find(params[:id]), MoqAlert).order(:po_number, :part_number, :order_type, :id)
      if params[:q].present?
        term = "%#{MoqAlert.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("po_number ILIKE :t OR part_number ILIKE :t", t: term)
      end
      alerts, meta = paginate(scope)
      descriptions = part_descriptions(alerts)
      render json: { data: alerts.map { |a| Serializers.moq_alert(a).merge(part_description: descriptions[a.id]) }, meta: meta }
    end

    # Row-level problems of a rejected upload, paged on the server. Optional `column` filter
    # ("_none" selects problems not tied to one column, such as duplicate rows).
    # The MOQ alerts as an .xlsx file: for each alert its MOQ and Qty, then the full order row (every column of
    # the order file, as shown on the Orders page).
    def moq_alerts_export
      batch = UploadBatch.find(params[:id])
      alerts = detections(batch, MoqAlert).order(:po_number, :part_number, :order_type, :id).limit(20_000).to_a
      imported = OrderRow.where(id: alerts.filter_map(&:order_row_id)).index_by(&:id)
      manual = ManualOrder.where(id: alerts.filter_map(&:manual_order_id)).index_by(&:id)
      columns = OrderRow.where(upload_batch_id: batch.id).where.not(source_columns: nil).pick(:source_columns) || ManualOrder::HEADERS
      rows = alerts.map do |alert|
        record = alert.order_row_id ? imported[alert.order_row_id] : manual[alert.manual_order_id]
        data = record&.source_data || {}
        [ alert.moq&.to_d, alert.qty&.to_d, alert.manual_order_id ? "Manual" : "Upload" ] + columns.map { |c| data[c] }
      end
      audit("moq_alerts.exported", subject: batch, rows: rows.size)
      send_data ExcelExport::XlsxWriter.call([ "MOQ", "Qty", "Source" ] + columns, rows, sheet_name: "MOQ alerts"),
                filename: "moq-alerts-#{batch.version_label || batch.id}-#{Date.current.iso8601}.xlsx",
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment"
    end

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
    # Part Description of each listed change or alert (id => text), as on the Orders page: the order file's Description
    # column (of its order row), else the product's (Products).
    def part_descriptions(records)
      row_of = records.to_h { |r| [ r.id, r.try(:order_row_id) || r.try(:previous_order_row_id) ] }
      from_file = OrderRow.where(id: row_of.values.compact).pluck(:id, Arel.sql("order_rows.source_data ->> 'Description'")).to_h
      products = Product.where(part_number: records.map(&:part_number).uniq).pluck(:part_number, :description).to_h
      records.to_h { |r| [ r.id, from_file[row_of[r.id]].to_s.squish.presence || products[r.part_number] ] }
    end

    # Part Numbers whose Part Description matches `like`, as the Changes tab shows it (two subqueries): the product's
    # (Products), or the order file's Description column in this upload or the one it was compared with.
    def described_parts(batch, like)
      uploads = [ batch.id, *QuantityChange.where(upload_batch_id: batch.id).distinct.pluck(:previous_upload_batch_id) ].compact
      [ Product.where("description ILIKE ?", like).select(:part_number),
        OrderRow.where(upload_batch_id: uploads).where("order_rows.source_data ->> 'Description' ILIKE ?", like).select(:part_number) ]
    end

    # Sort key of a change in the Changes tab's one list (quantity and address changes together), as CHANGE_SORTS.
    def all_changes_order(sort)
      case sort
      when "po" then ->(c) { [ c.po_number, c.try(:po_line_number).to_s.rjust(10, "0"), c.ship_date, c.class.name, c.id ] }
      when "part" then ->(c) { [ c.part_number, c.ship_date, c.class.name, c.id ] }
      when "difference" then ->(c) { [ -(c.try(:difference) || 0).abs, c.ship_date, c.class.name, c.id ] }
      else ->(c) { [ c.ship_date, c.po_number, c.try(:po_line_number).to_s.rjust(10, "0"), c.class.name, c.id ] }
      end
    end

    def detections(batch, model)
      scope = model.where(upload_batch_id: batch.id)
      return scope unless params[:manual] == "1" && batch == UploadBatch.latest_completed(batch.business)

      scope.or(ManualOrder.detections(model, since: batch.completed_at, business: batch.business))
    end
  end
end
