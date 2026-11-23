# The John Deere sync alerts become a choice for admins too (Users → Permissions), instead of always on. The admins of
# now keep getting them until someone unticks the box.
class TickDeereSyncAlertsForAdmins < ActiveRecord::Migration[8.1]
  def up
    execute "UPDATE users SET deere_sync_alerts = TRUE WHERE role = 'admin'"
  end

  def down
    # Nothing to undo: before this, admins got the alerts whatever the column said.
  end
end
