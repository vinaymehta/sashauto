module VendorOrders
  # Emails one Vendor Order to its vendor. Same guarantees as the admin alerts: row lock, never sent twice,
  # failures saved before Sidekiq retries, Resend idempotency key. When the vendor has no email address, the
  # email goes to the default recipients (ADMIN_NOTIFICATION_EMAILS in .env, else the Admin users) with a
  # note to forward it; "no_email" is used only when there is no recipient at all.
  class DeliverJob < ApplicationJob
    queue_as :mailers

    retry_on StandardError, attempts: 8, wait: :polynomially_longer do |job, error|
      Rails.logger.error("[vendor_orders] giving up on vendor order #{job.arguments.first}: #{error.class}: #{error.message}")
    end

    def perform(vendor_order_id)
      order = VendorOrder.includes(:vendor).find(vendor_order_id)
      error = nil

      order.with_lock do
        return if order.email_sent?

        fallback = order.vendor.email.blank?
        recipients = fallback ? Notifications::Outbox.recipients : [ order.vendor.email ]
        if recipients.empty?
          order.update!(email_status: "no_email", email_recipient: nil,
                        email_last_error: "The vendor has no email address and no default recipient is configured.")
          return
        end
        recipient = recipients.join(", ")

        order.email_attempts += 1
        order.email_last_attempt_at = Time.current
        begin
          message = VendorOrderMailer.with(vendor_order: order, recipients: recipients, fallback: fallback).placed.deliver_now
        rescue StandardError => e
          error = e
        end

        if error
          order.update!(email_status: "failed", email_recipient: recipient, email_last_error: "#{error.class}: #{error.message}".first(2000))
          AuditLog.record("vendor_order.email_failed", subject: order, attempt: order.email_attempts, error: error.class.name)
        else
          order.update!(email_status: "sent", email_recipient: recipient, email_sent_at: Time.current, email_last_error: nil,
                        email_provider_message_id: message&.message_id)
          AuditLog.record("vendor_order.email_sent", subject: order, recipient: recipient)
        end
      end

      raise error if error
    end

    def self.dispatch(order)
      perform_later(order.id)
    rescue StandardError => e
      Rails.logger.error("[vendor_orders] enqueue failed for vendor order #{order.id}: #{e.class}: #{e.message}")
    end
  end
end
