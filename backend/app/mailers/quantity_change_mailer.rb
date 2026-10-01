class QuantityChangeMailer < ApplicationMailer
  # Keeps the email a reasonable size; the full list is always in the dashboard.
  MAX_ROWS_IN_EMAIL = 500

  def changes_detected
    @notification = params.fetch(:notification)
    @batch = @notification.upload_batch
    @changes = @batch.quantity_changes.order(:ship_date, :po_number, :po_line_number, :part_number).limit(MAX_ROWS_IN_EMAIL).to_a
    @total = @notification.change_count
    @address_changes = @batch.address_changes.order(:po_number, :part_number, :ship_date).limit(MAX_ROWS_IN_EMAIL).to_a
    @address_total = @notification.address_change_count
    @heading = heading
    @url = "#{AppConfig.app_url}/detect"

    # Idempotency key: a Sidekiq retry of the same notification is never delivered twice by Resend.
    mail(to: @notification.recipients, subject: @notification.subject,
         options: { idempotency_key: "notification-#{@notification.id}" })
  end

  private

  def heading
    return "Quantity changes detected" if @address_total.zero?
    return "Address changes detected" if @total.zero?
    "Order changes detected"
  end
end
