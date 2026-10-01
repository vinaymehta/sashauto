# Ship To Address changes on current order rows (latest Ship Date per PO Number + Part Number + Type)
# between an upload and the previous one. Append-only, like quantity_changes.
class CreateAddressChanges < ActiveRecord::Migration[8.1]
  def up
    create_table :address_changes do |t|
      t.references :upload_batch, null: false, foreign_key: true, index: false
      t.references :previous_upload_batch, null: false, foreign_key: { to_table: :upload_batches }
      t.references :order_row, null: false, foreign_key: true
      t.references :previous_order_row, null: false, foreign_key: { to_table: :order_rows }
      t.string :group_key, null: false, limit: 64
      t.string :po_number, null: false
      t.string :part_number, null: false
      t.string :order_type, null: false
      t.date :ship_date, null: false
      t.text :old_address
      t.text :new_address
      t.datetime :created_at, null: false
    end
    add_index :address_changes, [ :upload_batch_id, :group_key ], unique: true, name: "index_address_changes_on_batch_and_group"
    execute <<~SQL
      CREATE TRIGGER address_changes_append_only
        BEFORE UPDATE OR DELETE ON address_changes
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
    SQL

    add_column :upload_batches, :address_change_count, :integer
    add_column :notifications, :address_change_count, :integer, null: false, default: 0
  end

  def down
    remove_column :notifications, :address_change_count
    remove_column :upload_batches, :address_change_count
    execute "DROP TRIGGER address_changes_append_only ON address_changes"
    drop_table :address_changes
  end
end
