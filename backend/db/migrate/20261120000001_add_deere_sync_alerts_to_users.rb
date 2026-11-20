# Who gets the Deere portal sync alerts (OTP needed, OTP timed out, sync failed: the in-app popup, the bell and an email).
# Admins always do; other users when an admin ticks "Deere sync alerts" for them (Users → Permissions). The bell reads
# the alerts from the audit log by action, hence the index.
class AddDeereSyncAlertsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :deere_sync_alerts, :boolean, null: false, default: false
    add_index :audit_logs, %i[action created_at]
  end
end
