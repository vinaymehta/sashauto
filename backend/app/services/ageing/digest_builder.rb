module Ageing
  # Builds the ageing email of one upload from its CURRENT rows: one row per PO Number + Part Number + Type
  # (the latest Ship Date), i.e. the rows shown on the Orders page, grouped by age band (Ageing::Rules: red under 15
  # days to ship date or overdue, yellow 15-44 days, green 45+ days).
  #
  # Called inside the upload's commit transaction (outbox): the digest commits with the upload, and the
  # caller hands it to Sidekiq after commit. Returns nil when the upload has no current rows.
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
      counts = Rules::BANDS.to_h { |band| [ band, current.where(ship_date: Rules.ship_date_range(band, @today)).count ] }
      total = counts.values.sum
      return nil if total.zero?

      digest = AgeingDigest.create!(
        mode: "upload", as_of: @today, upload_batch: @batch, recipients: Notifications::Outbox.recipients,
        counts: counts, row_count: total,
        subject: "Order ageing: #{counts['red']} red · #{counts['yellow']} yellow · #{counts['green']} green (#{@today.strftime('%-d %b %Y')})"
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
