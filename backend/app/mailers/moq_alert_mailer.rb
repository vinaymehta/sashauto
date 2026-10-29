# The parts of one upload whose balance still to order (Firm Qty - PO issued) is below their MOQ, as SASH reports
# them (Comparison::MoqChecker).
class MoqAlertMailer < ApplicationMailer
  MAX_ROWS_IN_EMAIL = 500

  def alerts_detected
    @notification = params.fetch(:notification)
    @batch = @notification.upload_batch
    @alerts = @batch.moq_alerts.order(:part_number, :po_number).limit(MAX_ROWS_IN_EMAIL).to_a
    @total = @notification.moq_alert_count
    @url = "#{AppConfig.app_url}/orders"

    mail(to: @notification.recipients, subject: @notification.subject,
         options: { idempotency_key: "notification-#{@notification.id}-#{@notification.created_at.to_i}" })
  end
end
