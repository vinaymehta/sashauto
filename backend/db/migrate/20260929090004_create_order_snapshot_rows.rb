class CreateOrderSnapshotRows < ActiveRecord::Migration[8.1]
  def change
    create_table :order_snapshot_rows do |t|
      t.references :upload_batch, null: false, foreign_key: true, index: false
      # SHA-256 of the normalized business key; the key fields are also stored below.
      t.string :business_key_hash, null: false, limit: 64
      t.string :ship_to_location, null: false
      t.string :order_type, null: false
      t.string :po_number, null: false
      t.string :po_line_number, null: false
      t.string :part_number, null: false
      t.date :ship_date, null: false

      t.string :commodity_type
      t.decimal :qty, precision: 15, scale: 3
      t.decimal :previous_qty, precision: 15, scale: 3
      t.decimal :effective_qty, precision: 15, scale: 3
      t.string :quantity_source, null: false
      t.string :current_release_number
      t.string :current_release_date
      # Every Excel row that collapsed into this business key (duplicates are kept traceable).
      t.integer :source_row_numbers, array: true, null: false, default: []
      t.datetime :created_at, null: false
    end
    add_index :order_snapshot_rows, [ :upload_batch_id, :business_key_hash ], unique: true,
              name: "index_order_snapshot_rows_on_batch_and_key"
    add_check_constraint :order_snapshot_rows, "quantity_source IN ('qty', 'previous_qty', 'unknown')",
                         name: "order_snapshot_rows_quantity_source_valid"
    add_check_constraint :order_snapshot_rows, "(quantity_source = 'unknown') = (effective_qty IS NULL)",
                         name: "order_snapshot_rows_effective_qty_consistent"
  end
end
