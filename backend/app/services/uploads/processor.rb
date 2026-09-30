module Uploads
  # Parses, validates and commits one upload as a new immutable version.
  #
  # Everything that makes a version visible (version number, snapshot rows, product sync,
  # comparison results, notification outbox record, status = completed) is written in ONE
  # transaction, so an upload is either fully committed or not a version at all.
  class Processor
    # Serializes version assignment and comparison across concurrent uploads.
    VERSION_LOCK_KEY = 7_311_002
    INSERT_SLICE = 1_000

    def self.call(batch_id)
      new(batch_id).call
    end

    def initialize(batch_id)
      @batch = UploadBatch.find(batch_id)
    end

    def call
      return @batch if @batch.finished?
      claim!

      result = @batch.file.open do |file|
        verify_checksum!(file.path)
        ExcelImport::OrderRowParser.new(ExcelImport::WorkbookReader.new(file.path)).call
      end

      if result.valid?
        commit!(result)
      else
        fail!("validation_failed", "#{result.errors.size} problem(s) found in the workbook.",
              validation_errors: result.errors, source_row_count: result.source_row_count)
      end
      @batch
    rescue ExcelImport::InvalidWorkbook => e
      fail!(e.code, e.message)
      @batch
    end

    # Called when retries are exhausted for an unexpected error.
    def self.mark_failed(batch_id, error)
      batch = UploadBatch.find_by(id: batch_id)
      return if batch.nil? || batch.finished?
      new(batch_id).send(:fail!, "processing_error",
        "The upload could not be processed because of an internal error. Please try again or contact support.",
        internal_error: "#{error.class}: #{error.message}")
    end

    private

    def claim!
      @batch.update!(status: "processing", processing_started_at: Time.current)
    end

    def verify_checksum!(path)
      return if Digest::SHA256.file(path).hexdigest == @batch.file_sha256
      raise "Stored file checksum mismatch for upload batch #{@batch.id}"
    end

    def commit!(result)
      notification = nil

      UploadBatch.transaction do
        UploadBatch.connection.execute("SELECT pg_advisory_xact_lock(#{VERSION_LOCK_KEY})")
        @batch.lock!
        return if @batch.finished?

        previous = UploadBatch.latest_completed
        insert_snapshot_rows(result.rows)
        conflicts = Products::SyncFromUpload.call(@batch, result.rows)
        stats = previous && Comparison::QuantityComparator.call(current_batch_id: @batch.id, previous_batch_id: previous.id)

        warnings = result.warnings.dup
        if conflicts.positive?
          warnings << { code: "commodity_conflict", count: conflicts,
                        message: "#{conflicts} Commodity Type conflict(s) with existing products need review on the Products page." }
        end

        @batch.update!(
          status: "completed", version_number: (previous&.version_number || 0) + 1,
          previous_upload_batch: previous, completed_at: Time.current,
          source_row_count: result.source_row_count, row_count: result.rows.size,
          duplicate_rows_merged: result.duplicate_rows_merged, unknown_quantity_count: result.unknown_quantity_count,
          warnings: warnings, **stats.to_h
        )

        change_count = stats ? stats.increase_count + stats.decrease_count : 0
        notification = Notifications::Outbox.enqueue_quantity_changes(@batch, change_count) if change_count.positive?
        AuditLog.record("upload.completed", user: @batch.uploaded_by, subject: @batch,
                        version: @batch.version_number, rows: result.rows.size, changes: change_count)
      end

      # After commit: the outbox row is durable, so a lost enqueue can be redelivered later.
      Notifications::Outbox.dispatch(notification) if notification
    end

    def insert_snapshot_rows(rows)
      now = Time.current
      rows.each_slice(INSERT_SLICE) do |slice|
        OrderSnapshotRow.insert_all!(slice.map { |row| snapshot_attrs(row, now) })
      end
    end

    def snapshot_attrs(row, now)
      row.slice(:business_key_hash, :ship_to_location, :order_type, :po_number, :po_line_number, :part_number,
                :ship_date, :commodity_type, :qty, :previous_qty, :effective_qty, :quantity_source,
                :current_release_number, :current_release_date, :source_row_numbers,
                *ExcelImport::OrderRowParser::DETAIL_TYPES.keys)
         .merge(upload_batch_id: @batch.id, created_at: now, details_loaded: true)
    end

    def fail!(code, message, validation_errors: [], source_row_count: nil, internal_error: nil)
      @batch.update!(status: "failed", failed_at: Time.current, error_code: code, error_message: message,
                     validation_errors: validation_errors.first(500), source_row_count: source_row_count)
      AuditLog.record("upload.failed", user: @batch.uploaded_by, subject: @batch, code: code,
                      error_count: validation_errors.size, internal_error: internal_error)
    end
  end
end
