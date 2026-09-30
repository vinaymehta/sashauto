class CreateAuditLogs < ActiveRecord::Migration[8.1]
  def change
    create_table :audit_logs do |t|
      t.references :user, foreign_key: true
      t.string :action, null: false
      t.string :subject_type
      t.bigint :subject_id
      t.jsonb :metadata, null: false, default: {}
      t.string :ip_address
      t.datetime :created_at, null: false
    end
    add_index :audit_logs, [ :subject_type, :subject_id ]
    add_index :audit_logs, :created_at
  end
end
