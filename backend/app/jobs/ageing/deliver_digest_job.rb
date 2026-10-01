module Ageing
  class DeliverDigestJob < ApplicationJob
    queue_as :mailers

    retry_on StandardError, attempts: 8, wait: :polynomially_longer do |job, error|
      Rails.logger.error("[ageing] giving up on digest #{job.arguments.first}: #{error.class}: #{error.message}")
    end

    # Same guarantees as the change alerts: row lock, never sent twice, failures are saved before
    # Sidekiq retries, and Resend deduplicates retries by idempotency key.
    def perform(digest_id)
      digest = AgeingDigest.find(digest_id)
      error = nil

      digest.with_lock do
        return if digest.sent? || digest.status == "skipped"

        digest.recipients = Notifications::Outbox.recipients
        digest.attempts += 1
        digest.last_attempt_at = Time.current
        begin
          raise Notifications::DeliverJob::NoRecipients, "No admin recipient configured" if digest.recipients.empty?
          message = AgeingMailer.with(digest: digest).digest.deliver_now
        rescue StandardError => e
          error = e
        end

        if error
          digest.update!(status: "failed", last_error: "#{error.class}: #{error.message}".first(2000))
          AuditLog.record("ageing.digest_failed", subject: digest, attempt: digest.attempts, error: error.class.name)
        else
          digest.update!(status: "sent", sent_at: Time.current, last_error: nil, provider_message_id: message&.message_id)
          AuditLog.record("ageing.digest_sent", subject: digest, recipients: digest.recipients)
        end
      end

      raise error if error
    end
  end
end
