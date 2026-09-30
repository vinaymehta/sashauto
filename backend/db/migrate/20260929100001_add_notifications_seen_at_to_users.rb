class AddNotificationsSeenAtToUsers < ActiveRecord::Migration[8.1]
  def change
    # Drives the unread badge on the notification bell.
    add_column :users, :notifications_seen_at, :datetime
    add_index :upload_batches, :completed_at
    add_index :upload_batches, :failed_at
  end
end
