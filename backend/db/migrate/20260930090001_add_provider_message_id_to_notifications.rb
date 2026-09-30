class AddProviderMessageIdToNotifications < ActiveRecord::Migration[8.1]
  def change
    # Id returned by the email provider (Resend) for a delivered notification.
    add_column :notifications, :provider_message_id, :string
  end
end
