# Notifications of the bell a user opened one by one (Activity::Feed item ids, newest last). "Mark as read" still sets
# notifications_seen_at for all of them at once.
class AddReadNotificationIdsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :read_notification_ids, :jsonb, default: [], null: false
  end
end
