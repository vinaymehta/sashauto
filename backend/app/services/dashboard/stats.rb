module Dashboard
  # Aggregates for the overview dashboard. Every figure is computed in PostgreSQL with a handful of
  # grouped queries over indexed columns; no snapshot rows are loaded into Ruby.
  class Stats
    TREND_VERSIONS = 12
    WINDOW = 30.days

    def self.call
      new.call
    end

    def call
      latest = UploadBatch.latest_completed
      {
        latest: latest && latest_summary(latest),
        totals: totals,
        last_30_days: last_30_days,
        trend: trend,
        composition: latest ? composition(latest) : nil,
        top_changes: top_changes,
        recent_uploads: UploadBatch.includes(:uploaded_by).order(created_at: :desc, id: :desc).limit(6).map { |b| Serializers.upload_batch(b) }
      }
    end

    private

    def latest_summary(batch)
      Serializers.upload_batch(batch).merge(
        previous_version: batch.previous_upload_batch&.version_number,
        increase_count: batch.increase_count, decrease_count: batch.decrease_count,
        compared_count: batch.compared_count, unknown_quantity_count: batch.unknown_quantity_count
      )
    end

    def totals
      uploads = UploadBatch.group(:status).count
      notifications = Notification.group(:status).count
      {
        versions: uploads.fetch("completed", 0),
        failed_uploads: uploads.fetch("failed", 0),
        in_progress: uploads.fetch("pending", 0) + uploads.fetch("processing", 0),
        products: Product.count,
        open_conflicts: ProductConflict.open.count,
        emails_sent: notifications.fetch("sent", 0),
        emails_failed: notifications.fetch("failed", 0),
        emails_pending: notifications.fetch("pending", 0)
      }
    end

    def last_30_days
      scope = UploadBatch.completed.where(completed_at: WINDOW.ago..)
      increases, decreases, versions = scope.pick(Arel.sql("COALESCE(SUM(increase_count), 0)"),
                                                 Arel.sql("COALESCE(SUM(decrease_count), 0)"), Arel.sql("COUNT(*)"))
      { versions: versions, increases: increases, decreases: decreases }
    end

    def trend
      UploadBatch.completed.order(version_number: :desc).limit(TREND_VERSIONS)
                 .pluck(:version_number, :completed_at, :increase_count, :decrease_count, :compared_count, :previous_upload_batch_id)
                 .reverse
                 .map do |version, at, inc, dec, compared, prev|
                   { version: version, completed_at: at, increases: inc.to_i, decreases: dec.to_i,
                     compared: compared, baseline: prev.nil? }
                 end
    end

    def composition(batch)
      rows = batch.order_snapshot_rows
      {
        by_type: rows.group(:order_type).count,
        by_quantity_source: rows.group(:quantity_source).count,
        by_ship_to: rows.group(:ship_to_location).count,
        ship_dates: { first: rows.minimum(:ship_date), last: rows.maximum(:ship_date) }
      }
    end

    # Largest changes of the most recent version that had any (the latest version may have none).
    def top_changes
      batch = UploadBatch.completed.where("increase_count + decrease_count > 0").order(version_number: :desc).first
      return { version: nil, changes: [] } unless batch

      changes = batch.quantity_changes.order(Arel.sql("abs(difference) DESC"), :id).limit(5)
      { version: batch.version_number, upload_id: batch.id, completed_at: batch.completed_at,
        changes: changes.map { |c| Serializers.quantity_change(c) } }
    end
  end
end
