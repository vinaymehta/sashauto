class CreateQuantityChanges < ActiveRecord::Migration[8.1]
  def change
    create_table :quantity_changes do |t|
      t.references :upload_batch, null: false, foreign_key: true, index: false
      t.references :previous_upload_batch, null: false, foreign_key: { to_table: :upload_batches }
      t.references :order_snapshot_row, null: false, foreign_key: true
      t.references :previous_order_snapshot_row, null: false, foreign_key: { to_table: :order_snapshot_rows }
      t.string :business_key_hash, null: false, limit: 64

      # Copied from the immutable snapshot row so change listings and emails need no joins.
      t.string :ship_to_location, null: false
      t.string :order_type, null: false
      t.string :po_number, null: false
      t.string :po_line_number, null: false
      t.string :part_number, null: false
      t.date :ship_date, null: false
      t.string :commodity_type

      t.decimal :old_qty, precision: 15, scale: 3, null: false
      t.decimal :new_qty, precision: 15, scale: 3, null: false
      t.decimal :difference, precision: 15, scale: 3, null: false
      t.string :direction, null: false
      t.datetime :created_at, null: false
    end
    add_index :quantity_changes, [ :upload_batch_id, :business_key_hash ], unique: true,
              name: "index_quantity_changes_on_batch_and_key"
    add_check_constraint :quantity_changes, "difference = new_qty - old_qty AND difference <> 0",
                         name: "quantity_changes_difference_valid"
    add_check_constraint :quantity_changes,
                         "(direction = 'increase' AND difference > 0) OR (direction = 'decrease' AND difference < 0)",
                         name: "quantity_changes_direction_valid"
  end
end
