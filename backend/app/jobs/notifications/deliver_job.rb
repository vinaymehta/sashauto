module Notifications
  class DeliverJob < ApplicationJob
    queue_as :mailers

    class NoRecipients < StandardError; end

    retry_on StandardError, attempts: 8, wait: :polynomially_longer do |job, error|
      Rails.logger.error("[notifications] giving up on notification #{job.arguments.first}: #{error.class}: #{error.message}")
    end

    # Delivery is at-least-once: the row lock prevents concurrent double sends, and a sent
    # notification is never sent again.
    def perform(notification_id)
      notification = Notification.find(notification_id)
      notification.with_lock do
        return if notification.sent?

        # TEMPORARY: always use the temporary recipient, including for emails queued before the change.
        notification.recipients = Notifications::Outbox.recipients
        # notification.recipients = Notifications::Outbox.recipients if notification.recipients.empty?
        notification.attempts += 1
        notification.last_attempt_at = Time.current

        begin
          raise NoRecipients, "No admin recipient configured (set ADMIN_NOTIFICATION_EMAILS or create an Admin user)" if notification.recipients.empty?
          QuantityChangeMailer.with(notification: notification).changes_detected.deliver_now
        rescue StandardError => e
          notification.update!(status: "failed", last_error: "#{e.class}: #{e.message}".first(2000))
          AuditLog.record("notification.failed", subject: notification, attempt: notification.attempts, error: e.class.name)
          raise
        end

        notification.update!(status: "sent", sent_at: Time.current, last_error: nil)
        AuditLog.record("notification.sent", subject: notification, recipients: notification.recipients)
      end
    end
  end
end
