class CreateNotifications < ActiveRecord::Migration[8.1]
  def change
    # Outbox: written in the same transaction as the upload's results, delivered afterwards by Sidekiq.
    create_table :notifications do |t|
      t.references :upload_batch, null: false, foreign_key: true, index: { unique: true }
      t.string :kind, null: false
      t.string :status, null: false, default: "pending"
      t.string :recipients, array: true, null: false, default: []
      t.string :subject, null: false
      t.integer :change_count, null: false
      t.integer :attempts, null: false, default: 0
      t.text :last_error
      t.datetime :last_attempt_at
      t.datetime :sent_at
      t.timestamps
    end
    add_index :notifications, :status
    add_check_constraint :notifications, "status IN ('pending', 'sent', 'failed')", name: "notifications_status_valid"
    add_check_constraint :notifications, "kind IN ('quantity_changes')", name: "notifications_kind_valid"
  end
end
