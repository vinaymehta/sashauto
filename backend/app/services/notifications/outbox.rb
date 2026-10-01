module Notifications
  # Transactional outbox for admin emails.
  module Outbox
    module_function

    # Must be called inside the upload's commit transaction.
    # One email per upload covering quantity and Ship To Address changes. A quantity-only email keeps
    # its original subject.
    def enqueue_quantity_changes(batch, change_count, address_change_count = 0)
      Notification.create!(
        upload_batch: batch, kind: "quantity_changes", status: "pending", recipients: recipients,
        change_count: change_count, address_change_count: address_change_count,
        subject: subject(batch, change_count, address_change_count)
      )
    end

    def subject(batch, quantity, address)
      rows = ->(n) { "#{n} order row#{'s' unless n == 1}" }
      detail =
        if address.zero? then "Quantity changes detected: #{rows.(quantity)}"
        elsif quantity.zero? then "Address changes detected: #{rows.(address)}"
        else "Order changes detected: #{quantity} quantity, #{address} address"
        end
      "#{detail} (upload of #{batch.completed_at.utc.strftime('%-d %b %Y, %H:%M UTC')})"
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
