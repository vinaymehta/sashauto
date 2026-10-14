# Order rows of one upload shipped to an address other than the default Ship To (Orders::ShipTo).
class ShipToAlertMailer < ApplicationMailer
  MAX_ROWS_IN_EMAIL = 500

  def alerts_detected
    @notification = params.fetch(:notification)
    @batch = @notification.upload_batch
    @default = AppConfig.default_ship_to
    default = Orders::ShipTo.default_key
    @rows = @batch.order_rows.order(:ship_date, :po_number, :po_line_number).select { |r| Orders::ShipTo.other?(r.source_data, default) }
    @total = @rows.size
    @rows = @rows.first(MAX_ROWS_IN_EMAIL)
    @url = "#{AppConfig.app_url}/orders"

    mail(to: @notification.recipients, subject: @notification.subject,
         options: { idempotency_key: "notification-#{@notification.id}-#{@notification.created_at.to_i}" })
  end
end
