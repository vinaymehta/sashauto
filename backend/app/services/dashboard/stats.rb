module Dashboard
  # The dashboard of a business view (Business: "dtp", "gmbh" or "all"): the latest upload, what needs attention, the
  # money figures (Dashboard::Money) and the operations figures (Dashboard::Overview).
  class Stats
    def self.call(view = "all")
      new(view).call
    end

    def initialize(view)
      @view = view
      @businesses = Business.of(view)
    end

    def call
      latest = UploadBatch.latest_for(@view).max_by(&:completed_at)
      today = Time.find_zone!(AppConfig.ageing_time_zone).today
      # One order list for both (Dashboard::Overview), so their counts agree.
      overview = Overview.new(today, @view)
      {
        latest: latest && latest_summary(latest),
        totals: totals,
        money: Money.call(today: today, overview: overview),
        overview: overview.call
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
      uploads = UploadBatch.where(business: @businesses).group(:status).count
      notifications = Notification.joins(:upload_batch).where(upload_batches: { business: @businesses }).group(:status).count
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
  end
end
