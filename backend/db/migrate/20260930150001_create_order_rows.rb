# Every Excel row of every upload, exactly as imported (all 47 source columns in `source_data`),
# plus typed columns for querying. Rows are grouped by PO Number + Part Number + Type; within a
# group the row with the latest Ship Date (first Excel row on a tie) is the group's CURRENT row and
# the others are its history. Append-only, like the other historical tables.
class CreateOrderRows < ActiveRecord::Migration[8.1]
  def up
    create_table :order_rows do |t|
      t.references :upload_batch, null: false, foreign_key: true, index: false
      t.integer :source_row_number, null: false
      t.string :group_key, null: false, limit: 64 # SHA-256 of PO Number + Part Number + Type
      t.boolean :current, null: false
      t.integer :group_row_count, null: false

      t.string :po_number, null: false
      t.string :part_number, null: false
      t.string :order_type, null: false
      t.date :ship_date, null: false
      t.string :po_line_number, null: false
      t.string :ship_to_location, null: false
      t.string :commodity_type
      t.decimal :qty, precision: 15, scale: 3
      t.decimal :previous_qty, precision: 15, scale: 3
      t.decimal :effective_qty, precision: 15, scale: 3
      t.string :quantity_source, null: false
      t.date :due_date
      t.string :unit
      t.string :plant_code
      t.decimal :last_asn_qty, precision: 15, scale: 3
      t.date :last_asn_date
      t.decimal :last_receipt_qty, precision: 15, scale: 3
      t.date :last_receipt_date
      t.string :last_packing_list_number
      t.string :crossdock_location
      t.string :dock_number
      t.string :supplier_part_number
      t.date :last_released_date
      t.date :last_updated_date

      # All source columns, keyed by the Excel header, with the original cell values, plus the headers
      # in their original Excel order (jsonb does not preserve key order).
      t.jsonb :source_data, null: false, default: {}
      t.string :source_columns, array: true, null: false, default: []
      t.datetime :created_at, null: false
    end
    add_index :order_rows, [ :upload_batch_id, :source_row_number ], unique: true, name: "index_order_rows_on_batch_and_excel_row"
    add_index :order_rows, [ :upload_batch_id, :group_key, :ship_date ], name: "index_order_rows_on_batch_group_ship_date"
    add_index :order_rows, [ :upload_batch_id, :current, :ship_date ], name: "index_order_rows_on_batch_current_ship_date"
    add_index :order_rows, [ :upload_batch_id, :po_number, :part_number ], name: "index_order_rows_on_batch_po_part"
    add_index :order_rows, [ :upload_batch_id, :part_number, :po_number ], name: "index_order_rows_on_batch_part_po"
    add_check_constraint :order_rows, "quantity_source IN ('qty', 'previous_qty', 'unknown')", name: "order_rows_quantity_source_valid"
    execute <<~SQL
      CREATE TRIGGER order_rows_append_only
        BEFORE UPDATE OR DELETE ON order_rows
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
    SQL

    # Quantity changes now reference the compared current order rows. Older changes keep their
    # snapshot-row references (DDL only; no existing row is modified).
    change_column_null :quantity_changes, :order_snapshot_row_id, true
    change_column_null :quantity_changes, :previous_order_snapshot_row_id, true
    add_reference :quantity_changes, :order_row, foreign_key: true
    add_reference :quantity_changes, :previous_order_row, foreign_key: { to_table: :order_rows }

    add_reference :ageing_notifications, :order_row, foreign_key: true
  end

  def down
    remove_reference :ageing_notifications, :order_row
    remove_reference :quantity_changes, :previous_order_row
    remove_reference :quantity_changes, :order_row
    execute "DROP TRIGGER order_rows_append_only ON order_rows"
    drop_table :order_rows
  end
end
