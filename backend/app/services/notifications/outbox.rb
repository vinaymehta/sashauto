module Notifications
  # Transactional outbox for admin emails.
  module Outbox
    module_function

    SUBJECTS = {
      "quantity_changes" => "Quantity changes detected", "address_changes" => "Address changes detected",
      "moq_alerts" => "Below MOQ"
    }.freeze

    # Must be called inside the upload's commit transaction. One email per kind that has rows, each with
    # its own template. Returns the created notifications.
    def enqueue_for_upload(batch, quantity:, address:, moq:)
      { "quantity_changes" => quantity, "address_changes" => address, "moq_alerts" => moq }.filter_map do |kind, count|
        next unless count.positive?

        Notification.create!(
          upload_batch: batch, kind: kind, status: "pending", recipients: recipients, subject: subject(batch, kind, count),
          change_count: kind == "quantity_changes" ? count : 0,
          address_change_count: kind == "address_changes" ? count : 0,
          moq_alert_count: kind == "moq_alerts" ? count : 0
        )
      end
    end

    def subject(batch, kind, count)
      "#{SUBJECTS.fetch(kind)}: #{count} order row#{'s' unless count == 1} " \
        "(upload of #{batch.completed_at.utc.strftime('%-d %b %Y, %H:%M UTC')})"
    end

    # Hands a committed outbox record to Sidekiq. If Redis is unavailable the record stays pending
    # and is picked up by `bin/rails notifications:redeliver` or the Retry action in the UI.
    def dispatch(notification)
      Notifications::DeliverJob.perform_later(notification.id)
    rescue StandardError => e
      Rails.logger.error("[notifications] enqueue failed for notification #{notification.id}: #{e.class}: #{e.message}")
    end

    # TEMPORARY: every notification email goes to this address.
    # To restore normal behaviour, delete TEMPORARY_RECIPIENTS and uncomment the original line below.
    # TEMPORARY_RECIPIENTS = [ "" ].freeze

    def recipients
       # TEMPORARY_RECIPIENTS
       AppConfig.admin_notification_emails.presence || User.active.admins.order(:id).pluck(:email)
    end
  end
end
