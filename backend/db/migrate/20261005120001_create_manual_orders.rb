# Orders created by an Admin by hand. Stored apart from imported order rows (uploads never touch them),
# with the same 47-column structure: typed columns for querying plus every Excel column in `source_data`.
# PO Number + Part Number + Type (group_key) is deliberately NOT unique: a manual order may share its
# key with imported rows or other manual orders. Deleting is soft (`deleted_at`) because detection
# records, which are append-only, reference the order.
#
# Quantity changes, address changes and MOQ alerts can now come from a manual order instead of an
# upload comparison: they reference `manual_order_id`, and the upload/order-row references become
# optional for those rows only (CHECK constraints keep upload-detected rows complete).
class CreateManualOrders < ActiveRecord::Migration[8.1]
  def up
    create_table :manual_orders do |t|
      t.string :group_key, null: false, limit: 64 # SHA-256 of PO Number + Part Number + Type
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
      t.jsonb :source_data, null: false, default: {}
      t.string :source_columns, array: true, null: false, default: []
      t.references :created_by, null: false, foreign_key: { to_table: :users }
      t.references :updated_by, null: false, foreign_key: { to_table: :users }
      t.datetime :deleted_at
      t.timestamps
    end
    add_index :manual_orders, :group_key
    add_check_constraint :manual_orders, "quantity_source IN ('qty', 'previous_qty', 'unknown')", name: "manual_orders_quantity_source_valid"
    add_check_constraint :manual_orders, "qty >= 0 AND previous_qty >= 0 AND last_asn_qty >= 0 AND last_receipt_qty >= 0",
                         name: "manual_orders_quantities_non_negative"

    add_reference :quantity_changes, :manual_order, foreign_key: true
    change_column_null :quantity_changes, :upload_batch_id, true
    change_column_null :quantity_changes, :previous_upload_batch_id, true
    add_check_constraint :quantity_changes,
                         "manual_order_id IS NOT NULL OR (upload_batch_id IS NOT NULL AND previous_upload_batch_id IS NOT NULL)",
                         name: "quantity_changes_source_present"

    add_reference :address_changes, :manual_order, foreign_key: true
    %i[upload_batch_id previous_upload_batch_id order_row_id previous_order_row_id].each do |column|
      change_column_null :address_changes, column, true
    end
    add_check_constraint :address_changes,
                         "manual_order_id IS NOT NULL OR (upload_batch_id IS NOT NULL AND previous_upload_batch_id IS NOT NULL " \
                         "AND order_row_id IS NOT NULL AND previous_order_row_id IS NOT NULL)",
                         name: "address_changes_source_present"

    # A manual order below MOQ is also alerted by each later upload's MOQ check (upload_batch_id set).
    # One alert per upload and PO + Part + Type stays unique for imported rows only, so a manual order
    # may share the key; a manual order is alerted at most once per upload.
    add_reference :moq_alerts, :manual_order, foreign_key: true
    change_column_null :moq_alerts, :upload_batch_id, true
    change_column_null :moq_alerts, :order_row_id, true
    remove_index :moq_alerts, name: "index_moq_alerts_on_batch_and_group"
    add_index :moq_alerts, [ :upload_batch_id, :group_key ], unique: true, where: "order_row_id IS NOT NULL",
                                                             name: "index_moq_alerts_on_batch_and_group"
    add_index :moq_alerts, [ :upload_batch_id, :manual_order_id ], unique: true,
                                                                   where: "upload_batch_id IS NOT NULL AND manual_order_id IS NOT NULL",
                                                                   name: "index_moq_alerts_on_batch_and_manual_order"
    add_check_constraint :moq_alerts, "(order_row_id IS NULL) <> (manual_order_id IS NULL)", name: "moq_alerts_one_order"
    add_check_constraint :moq_alerts, "upload_batch_id IS NOT NULL OR manual_order_id IS NOT NULL", name: "moq_alerts_source_present"
  end

  def down
    remove_check_constraint :moq_alerts, name: "moq_alerts_source_present"
    remove_check_constraint :moq_alerts, name: "moq_alerts_one_order"
    remove_check_constraint :address_changes, name: "address_changes_source_present"
    remove_check_constraint :quantity_changes, name: "quantity_changes_source_present"
    # Detection rows of manual orders are append-only; this migration cannot be reversed once any exist.
    remove_index :moq_alerts, name: "index_moq_alerts_on_batch_and_manual_order"
    remove_index :moq_alerts, name: "index_moq_alerts_on_batch_and_group"
    add_index :moq_alerts, [ :upload_batch_id, :group_key ], unique: true, name: "index_moq_alerts_on_batch_and_group"
    remove_reference :moq_alerts, :manual_order
    remove_reference :address_changes, :manual_order
    remove_reference :quantity_changes, :manual_order
    change_column_null :moq_alerts, :upload_batch_id, false
    change_column_null :moq_alerts, :order_row_id, false
    %i[upload_batch_id previous_upload_batch_id order_row_id previous_order_row_id].each do |column|
      change_column_null :address_changes, column, false
    end
    change_column_null :quantity_changes, :upload_batch_id, false
    change_column_null :quantity_changes, :previous_upload_batch_id, false
    drop_table :manual_orders
  end
end
