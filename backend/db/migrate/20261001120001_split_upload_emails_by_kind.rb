# One email per kind of upload alert (quantity changes, address changes, MOQ alerts) instead of one
# combined email, and ageing digests sent on upload (mode "upload") instead of a daily schedule.
class SplitUploadEmailsByKind < ActiveRecord::Migration[8.1]
  def up
    remove_index :notifications, :upload_batch_id
    add_index :notifications, [ :upload_batch_id, :kind ], unique: true
    remove_check_constraint :notifications, name: "notifications_kind_valid"
    add_check_constraint :notifications, "kind IN ('quantity_changes', 'address_changes', 'moq_alerts')", name: "notifications_kind_valid"

    remove_check_constraint :ageing_digests, name: "ageing_digests_mode_valid"
    add_check_constraint :ageing_digests, "mode IN ('scheduled', 'manual', 'preview', 'baseline', 'upload')", name: "ageing_digests_mode_valid"
  end

  def down
    remove_check_constraint :ageing_digests, name: "ageing_digests_mode_valid"
    add_check_constraint :ageing_digests, "mode IN ('scheduled', 'manual', 'preview', 'baseline')", name: "ageing_digests_mode_valid"

    remove_check_constraint :notifications, name: "notifications_kind_valid"
    add_check_constraint :notifications, "kind = 'quantity_changes'", name: "notifications_kind_valid"
    remove_index :notifications, [ :upload_batch_id, :kind ]
    add_index :notifications, :upload_batch_id, unique: true
  end
end
