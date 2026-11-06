# Uploaded SASH invoices (Orders → Actions): a SASH India export invoice (SASH Autotech Pvt. Ltd. to Lotus Automotive)
# moves order Qty to dispatched, a SASH Inc invoice (SASH Autotech, Inc. to John Deere) moves dispatched Qty to
# outbound. Each invoice keeps its file, the lines read from it and the lines no order took (unmatched); its
# allocations are the Qty each order row got (oldest Ship Date first), keyed like the status marks (order_key) so they
# stay on the order in later uploads. Removing an invoice (admin) keeps it with removed_at/by.
class CreateInvoices < ActiveRecord::Migration[8.1]
  def change
    create_table :invoices do |t|
      t.string :kind, null: false
      t.string :business
      t.string :invoice_number, limit: 64, null: false
      t.date :invoice_date, null: false
      t.string :exporter
      t.string :original_filename, null: false
      t.jsonb :lines, null: false, default: []
      t.jsonb :unmatched_lines, null: false, default: []
      t.decimal :total_qty, precision: 15, scale: 3, null: false, default: 0
      t.decimal :matched_qty, precision: 15, scale: 3, null: false, default: 0
      t.references :uploaded_by, null: false, foreign_key: { to_table: :users }
      t.datetime :removed_at
      t.references :removed_by, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_check_constraint :invoices, "kind IN ('india', 'inc')", name: "invoices_kind_valid"
    add_index :invoices, %i[kind invoice_number], unique: true, where: "removed_at IS NULL", name: "index_invoices_one_active_number"

    create_table :invoice_allocations do |t|
      t.references :invoice, null: false, foreign_key: true
      t.integer :line_index, null: false
      t.string :order_key, limit: 64, null: false
      t.references :order_row, foreign_key: true
      t.references :manual_order, foreign_key: true
      t.string :po_number, null: false
      t.string :po_line_number, null: false
      t.string :part_number, null: false
      t.string :order_type, null: false
      t.date :ship_date, null: false
      t.decimal :order_qty, precision: 15, scale: 3
      t.decimal :qty, precision: 15, scale: 3, null: false
      t.datetime :created_at, null: false
    end
    add_check_constraint :invoice_allocations, "qty > 0", name: "invoice_allocations_qty_positive"
    add_check_constraint :invoice_allocations, "(order_row_id IS NULL) <> (manual_order_id IS NULL)", name: "invoice_allocations_one_order"
    add_index :invoice_allocations, :order_key
    add_index :invoice_allocations, %i[po_number part_number order_type po_line_number ship_date], name: "index_invoice_allocations_on_order"
  end
end
