class QuantityChangeMailer < ApplicationMailer
  # Keeps the email a reasonable size; the full list is always in the dashboard.
  MAX_ROWS_IN_EMAIL = 500

  def changes_detected
    @notification = params.fetch(:notification)
    @batch = @notification.upload_batch
    @changes = @batch.quantity_changes.order(:ship_date, :po_number, :po_line_number, :part_number).limit(MAX_ROWS_IN_EMAIL).to_a
    @total = @notification.change_count
    @url = "#{AppConfig.app_url}/detect"

    mail(to: @notification.recipients, subject: @notification.subject)
  end
end
