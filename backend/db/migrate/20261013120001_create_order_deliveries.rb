# Deliveries reported by the Warehouse Manager on an order row: inbound (received at SASH US) and outbound
# (delivered to Deere). One active mark per order and kind; an admin can remove a wrong one (kept, with who/when).
class CreateOrderDeliveries < ActiveRecord::Migration[8.1]
  def change
    create_table :order_deliveries do |t|
      t.string :order_key, limit: 64, null: false
      t.string :kind, null: false
      t.references :order_row, foreign_key: true
      t.references :manual_order, foreign_key: true
      t.string :po_number, null: false
      t.string :po_line_number, null: false
      t.string :part_number, null: false
      t.string :order_type, null: false
      t.date :ship_date, null: false
      t.date :delivered_on, null: false
      t.string :note, limit: 500
      t.references :marked_by, null: false, foreign_key: { to_table: :users }
      t.datetime :removed_at
      t.references :removed_by, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_check_constraint :order_deliveries, "kind IN ('inbound', 'outbound')", name: "order_deliveries_kind_valid"
    add_check_constraint :order_deliveries, "(order_row_id IS NULL) <> (manual_order_id IS NULL)", name: "order_deliveries_one_order"
    add_index :order_deliveries, %i[order_key kind], unique: true, where: "removed_at IS NULL", name: "index_order_deliveries_one_active"
  end
end
