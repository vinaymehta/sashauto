# The IP address of each user's last sign-in, shown on Users next to Last sign-in. Filled for existing users from their
# last sign-in in the audit log.
class AddLastLoginIpToUsers < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :last_login_ip, :string, limit: 45
    execute <<~SQL.squish
      UPDATE users SET last_login_ip = (
        SELECT a.ip_address FROM audit_logs a WHERE a.action = 'session.login' AND a.user_id = users.id AND a.ip_address IS NOT NULL
        ORDER BY a.created_at DESC LIMIT 1)
    SQL
  end

  def down
    remove_column :users, :last_login_ip
  end
end
