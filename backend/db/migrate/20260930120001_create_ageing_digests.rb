# Daily order-ageing emails: which order rows have been emailed at 30 / 60 / 90 days past their
# ship date, and the digest (outbox record) each email was sent as.
class CreateAgeingDigests < ActiveRecord::Migration[8.1]
  def change
    create_table :ageing_digests do |t|
      t.string :mode, null: false          # scheduled | manual | preview | baseline
      t.string :status, null: false, default: "pending"
      t.date :as_of, null: false           # the day the ages were calculated for
      t.references :upload_batch, foreign_key: true
      t.references :requested_by, foreign_key: { to_table: :users }
      t.string :recipients, array: true, null: false, default: []
      t.string :subject
      t.jsonb :counts, null: false, default: {}  # {"30"=>n, "60"=>n, "90"=>n}
      t.integer :row_count, null: false, default: 0
      t.integer :attempts, null: false, default: 0
      t.text :last_error
      t.string :provider_message_id
      t.datetime :last_attempt_at
      t.datetime :sent_at
      t.timestamps
    end
    add_index :ageing_digests, [ :mode, :created_at ]
    add_check_constraint :ageing_digests, "mode IN ('scheduled', 'manual', 'preview', 'baseline')", name: "ageing_digests_mode_valid"
    add_check_constraint :ageing_digests, "status IN ('pending', 'sent', 'failed', 'skipped')", name: "ageing_digests_status_valid"

    # One row per (order row identity, threshold) ever notified — never emailed twice.
    create_table :ageing_notifications do |t|
      t.string :business_key_hash, null: false, limit: 64
      t.integer :threshold, null: false
      t.references :ageing_digest, null: false, foreign_key: true
      t.references :order_snapshot_row, foreign_key: true
      t.datetime :created_at, null: false
    end
    add_index :ageing_notifications, [ :business_key_hash, :threshold ], unique: true, name: "index_ageing_notifications_once_per_threshold"
    add_check_constraint :ageing_notifications, "threshold IN (30, 60, 90)", name: "ageing_notifications_threshold_valid"
  end
end
