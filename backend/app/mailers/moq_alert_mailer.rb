# Current rows of one upload whose Qty is below the Part Number's MOQ.
class MoqAlertMailer < ApplicationMailer
  MAX_ROWS_IN_EMAIL = 500

  def alerts_detected
    @notification = params.fetch(:notification)
    @batch = @notification.upload_batch
    @alerts = @batch.moq_alerts.order(:po_number, :part_number, :order_type).limit(MAX_ROWS_IN_EMAIL).to_a
    @total = @notification.moq_alert_count
    @url = "#{AppConfig.app_url}/orders"

    mail(to: @notification.recipients, subject: @notification.subject,
         options: { idempotency_key: "notification-#{@notification.id}" })
  end
end
