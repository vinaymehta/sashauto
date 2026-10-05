# Ship To Address changes of one upload (current rows compared with the previous upload).
class AddressChangeMailer < ApplicationMailer
  MAX_ROWS_IN_EMAIL = 500

  def changes_detected
    @notification = params.fetch(:notification)
    @batch = @notification.upload_batch
    @changes = @batch.address_changes.order(:po_number, :part_number, :ship_date).limit(MAX_ROWS_IN_EMAIL).to_a
    @total = @notification.address_change_count
    @url = "#{AppConfig.app_url}/orders"

    mail(to: @notification.recipients, subject: @notification.subject,
         options: { idempotency_key: "notification-#{@notification.id}" })
  end
end
