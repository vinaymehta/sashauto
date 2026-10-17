module Ageing
  # Builds the ageing email of one upload from its order rows, grouped by age band (Ageing::Rules: days since the
  # Firm Date; green 30-59, yellow 60-89, red 90 or more; orders under 30 days or without a Firm Date are not listed).
  #
  # Called inside the upload's commit transaction (outbox): the digest commits with the upload, and the
  # caller hands it to Sidekiq after commit. Returns nil when no row is in a band.
  class DigestBuilder
    def self.call(batch:, today:)
      new(batch, today).call
    end

    def initialize(batch, today)
      @batch = batch
      @today = today
    end

    def call
      counts = Rules::BANDS.to_h { |band| [ band, Rules.in_bands(@batch.order_rows, [ band ], @today).count ] }
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
