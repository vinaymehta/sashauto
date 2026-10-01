module Ageing
  # Builds the ageing email of one upload from its CURRENT rows: one row per PO Number + Part Number + Type
  # (the latest Ship Date), i.e. the rows shown on the Orders page. Every upload lists ALL current rows that
  # are 30-59, 60-89 or 90+ days past their ship date; nothing is skipped because it was emailed before.
  #
  # Called inside the upload's commit transaction (outbox): the digest commits with the upload, and the
  # caller hands it to Sidekiq after commit. Returns nil when no current row is 30+ days old.
  class DigestBuilder
    def self.call(batch:, today:)
      new(batch, today).call
    end

    def initialize(batch, today)
      @batch = batch
      @today = today
    end

    def call
      current = @batch.order_rows.current_rows
      counts = Rules::THRESHOLDS.to_h { |t| [ t.to_s, current.where(ship_date: Rules.ship_date_range(t, @today)).count ] }
      total = counts.values.sum
      return nil if total.zero?

      digest = AgeingDigest.create!(
        mode: "upload", as_of: @today, upload_batch: @batch, recipients: Notifications::Outbox.recipients,
        counts: counts, row_count: total,
        subject: "Order ageing: #{total} order row#{'s' unless total == 1} 30+ days past ship date (#{@today.strftime('%-d %b %Y')})"
      )
      AuditLog.record("ageing.digest_created", subject: digest, mode: "upload", counts: counts)
      digest
    end

    # Hands a committed digest to Sidekiq.
    def self.dispatch(digest)
      Ageing::DeliverDigestJob.perform_later(digest.id)
    rescue StandardError => e
      Rails.logger.error("[ageing] enqueue failed for digest #{digest.id}: #{e.class}: #{e.message}")
    end
  end
end
