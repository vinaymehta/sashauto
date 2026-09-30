class CreateUploadBatches < ActiveRecord::Migration[8.1]
  def change
    create_table :upload_batches do |t|
      # Assigned only when processing commits successfully, so versions are gap-free: V1, V2, V3...
      t.integer :version_number
      t.string :status, null: false, default: "pending"
      t.references :uploaded_by, null: false, foreign_key: { to_table: :users }
      t.references :previous_upload_batch, foreign_key: { to_table: :upload_batches }

      t.string :original_filename, null: false
      t.string :file_sha256, null: false, limit: 64
      t.bigint :byte_size, null: false
      t.string :content_type

      t.integer :source_row_count
      t.integer :row_count
      t.integer :duplicate_rows_merged
      t.integer :unknown_quantity_count
      t.integer :compared_count
      t.integer :increase_count
      t.integer :decrease_count
      t.integer :unchanged_count
      t.integer :new_row_count
      t.integer :missing_row_count

      t.string :error_code
      t.text :error_message
      t.jsonb :validation_errors, null: false, default: []
      t.jsonb :warnings, null: false, default: []

      t.datetime :processing_started_at
      t.datetime :completed_at
      t.datetime :failed_at
      t.timestamps
    end
    add_index :upload_batches, :version_number, unique: true
    add_index :upload_batches, :file_sha256
    add_index :upload_batches, [ :status, :created_at ]
    add_check_constraint :upload_batches, "status IN ('pending', 'processing', 'completed', 'failed')", name: "upload_batches_status_valid"
    add_check_constraint :upload_batches, "(status = 'completed') = (version_number IS NOT NULL)", name: "upload_batches_version_iff_completed"
  end
end
