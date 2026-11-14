# Purchase orders page: vendor PO lists uploaded as files (a Deere dump with Vendor Name, PO Qty Issued and the vendor
# PO number of each order). Each listed order gets a placement and a vendor order with the file's PO number (source
# "file", no PDF); several orders can share a vendor PO number, so it is unique only among the app's own POs.
# "Goods received" (the vendor's material at SASH Faridabad) is ticked per vendor order.
class CreateVendorPoImports < ActiveRecord::Migration[8.1]
  def change
    create_table :vendor_po_imports do |t|
      t.string :business, null: false
      t.string :original_filename, null: false
      t.references :uploaded_by, null: false, foreign_key: { to_table: :users }
      t.integer :rows_count, null: false, default: 0
      t.integer :created_count, null: false, default: 0
      t.jsonb :skipped, null: false, default: []
      t.timestamps
    end

    add_reference :vendor_order_placements, :vendor_po_import, foreign_key: true
    add_column :vendor_orders, :source, :string, null: false, default: "app"
    add_check_constraint :vendor_orders, "source IN ('app', 'file')", name: "vendor_orders_source_valid"
    remove_index :vendor_orders, :number, unique: true
    add_index :vendor_orders, :number, unique: true, where: "source = 'app'", name: "index_vendor_orders_on_number_app"
    add_index :vendor_orders, :number, name: "index_vendor_orders_on_number"
    add_column :vendor_orders, :goods_received_at, :datetime
    add_reference :vendor_orders, :goods_received_by, foreign_key: { to_table: :users }
  end
end
