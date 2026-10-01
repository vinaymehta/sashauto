module Ageing
  # Builds one ageing digest for the latest order data: the CURRENT rows (latest Ship Date per
  # PO Number + Part Number + Type), i.e. the rows shown on the Orders page.
  #
  #   mode "scheduled"/"manual": rows that newly reached 30/60/90 days (not emailed before for that
  #     threshold). Each row is listed once, under the highest threshold it reached; lower thresholds
  #     are recorded as done too. Rows and digest are written in one transaction (outbox), then the
  #     email is sent by Sidekiq.
  #   First run ever: rows already past a threshold are recorded as done WITHOUT an email (baseline).
  #   mode "preview": the rows currently in each band; nothing is recorded as notified (for testing).
  class DigestBuilder
    Result = Data.define(:digest, :counts, :status) do
      def to_h = { digest_id: digest&.id, counts: counts, status: status }
    end

    def self.call(mode:, today: Date.current, user: nil)
      new(mode, today, user).call
    end

    def initialize(mode, today, user)
      raise ArgumentError, "unknown mode #{mode}" unless %w[scheduled manual preview].include?(mode)
      @mode = mode
      @today = today
      @user = user
    end

    def call
      batch = UploadBatch.latest_completed
      return Result.new(digest: nil, counts: {}, status: "no_data") unless batch

      @mode == "preview" ? preview(batch) : notify(batch)
    end

    private

    def rows_past(batch, threshold)
      batch.order_rows.current_rows.where(ship_date: ..(@today - threshold))
    end

    # A current row is identified by its group and ship date (a new latest line is a new row to age).
    def self.row_key(row)
      Digest::SHA256.hexdigest("#{row.group_key}#{OrderRows::Normalizer::KEY_SEPARATOR}#{row.ship_date.iso8601}")
    end

    def preview(batch)
      counts = Rules::THRESHOLDS.to_h { |t| [ t.to_s, batch.order_rows.current_rows.where(ship_date: Rules.ship_date_range(t, @today)).count ] }
      total = counts.values.sum
      return Result.new(digest: nil, counts: counts, status: "empty") if total.zero?

      digest = AgeingDigest.create!(mode: "preview", as_of: @today, upload_batch: batch, requested_by: @user,
                                    recipients: Notifications::Outbox.recipients, counts: counts, row_count: total,
                                    subject: "[Test] Order ageing: #{total} order row#{'s' unless total == 1} at 30+ days")
      dispatch(digest)
      Result.new(digest: digest, counts: counts, status: "queued")
    end

    def notify(batch)
      digest = nil
      counts = {}
      AgeingDigest.transaction do
        AgeingDigest.connection.execute("SELECT pg_advisory_xact_lock(7311003)") # one digest run at a time
        baseline = !AgeingDigest.exists?(mode: "baseline")
        pending = new_crossings(batch)
        counts = Rules::THRESHOLDS.to_h { |t| [ t.to_s, pending.count { |_, threshold| threshold == t } ] }

        if baseline
          digest = AgeingDigest.create!(mode: "baseline", status: "skipped", as_of: @today, upload_batch: batch,
                                        requested_by: @user, counts: counts, row_count: pending.size)
          record(digest, pending)
          AuditLog.record("ageing.baseline", user: @user, subject: digest, counts: counts)
          return Result.new(digest: digest, counts: counts, status: "baseline")
        end
        return Result.new(digest: nil, counts: counts, status: "empty") if pending.empty?

        digest = AgeingDigest.create!(
          mode: @mode, as_of: @today, upload_batch: batch, requested_by: @user, recipients: Notifications::Outbox.recipients,
          counts: counts, row_count: pending.size,
          subject: "Order ageing: #{pending.size} order row#{'s' unless pending.size == 1} reached 30/60/90 days (#{@today.strftime('%-d %b %Y')})"
        )
        record(digest, pending)
        AuditLog.record("ageing.digest_created", user: @user, subject: digest, mode: @mode, counts: counts)
      end
      dispatch(digest)
      Result.new(digest: digest, counts: counts, status: "queued")
    end

    # [[snapshot_row, highest threshold reached]] for rows whose highest threshold was never notified.
    def new_crossings(batch)
      rows = rows_past(batch, Rules::THRESHOLDS.first).select(:id, :group_key, :ship_date).to_a
      keys = rows.to_h { |row| [ row.id, self.class.row_key(row) ] }
      notified = AgeingNotification.where(business_key_hash: keys.values).pluck(:business_key_hash, :threshold).to_set
      rows.filter_map do |row|
        threshold = Rules.threshold_for(row.ship_date, @today)
        [ row, threshold ] if threshold && !notified.include?([ keys[row.id], threshold ])
      end
    end

    # Marks the reached threshold and every lower one as done for each row.
    def record(digest, pending)
      now = Time.current
      records = pending.flat_map do |row, threshold|
        Rules::THRESHOLDS.select { |t| t <= threshold }.map do |t|
          { business_key_hash: self.class.row_key(row), threshold: t, ageing_digest_id: digest.id,
            order_row_id: row.id, created_at: now }
        end
      end
      AgeingNotification.insert_all(records, unique_by: :index_ageing_notifications_once_per_threshold) if records.any?
    end

    def dispatch(digest)
      Ageing::DeliverDigestJob.perform_later(digest.id)
    rescue StandardError => e
      Rails.logger.error("[ageing] enqueue failed for digest #{digest.id}: #{e.class}: #{e.message}")
    end
  end
end
