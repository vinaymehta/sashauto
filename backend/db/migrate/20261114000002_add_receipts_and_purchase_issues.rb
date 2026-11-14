# Purchase orders: the date of each vendor PO (order_date), what the vendors delivered against them (receipts: the
# vendor's invoice number, date and Qty, from a Purchase Received file or entered by hand), and the rows of uploaded
# lists that could not be recorded (purchase_issues, worked on in the Import issues tab like Products' and Vendors').
class AddReceiptsAndPurchaseIssues < ActiveRecord::Migration[8.1]
  def change
    add_column :vendor_orders, :order_date, :date
    add_column :vendor_po_imports, :kind, :string, null: false, default: "orders"
    add_check_constraint :vendor_po_imports, "kind IN ('orders', 'received')", name: "vendor_po_imports_kind_valid"

    create_table :vendor_order_receipts do |t|
      t.references :vendor_order, null: false, foreign_key: true
      t.date :received_on, null: false
      t.string :invoice_number, null: false
      t.decimal :qty, precision: 15, scale: 3, null: false
      t.decimal :rate, precision: 15, scale: 4
      t.decimal :value, precision: 15, scale: 2
      t.references :vendor_po_import, foreign_key: true
      t.references :created_by, null: false, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_check_constraint :vendor_order_receipts, "qty > 0", name: "vendor_order_receipts_qty_positive"

    create_table :purchase_issues do |t|
      t.references :vendor_po_import, null: false, foreign_key: true
      t.string :business, null: false
      t.integer :excel_row
      t.string :reason_kind, null: false
      t.text :reason, null: false
      t.jsonb :row_data, null: false, default: {}
      t.string :status, null: false, default: "open"
      t.string :resolution
      t.references :resolved_by, foreign_key: { to_table: :users }
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :purchase_issues, :status
    add_check_constraint :purchase_issues, "status IN ('open', 'resolved', 'dismissed')", name: "purchase_issues_status_valid"
  end
end
