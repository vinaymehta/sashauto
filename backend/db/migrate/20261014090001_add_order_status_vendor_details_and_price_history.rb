# Manager feedback (Oct 2026):
# - Order status: SASH India marks "received at SASH Faridabad" and "dispatched from SASH Faridabad" (with the
#   SASH India invoice number) before the Warehouse Manager's inbound / outbound.
# - Vendor address, GST and phone.
# - Customer price per part (Unit Price of the order file, per 100 pcs) and a price history for customer and
#   vendor prices.
# - Email alert for order rows shipped to an address other than the default Ship To.
class AddOrderStatusVendorDetailsAndPriceHistory < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :order_deliveries, name: "order_deliveries_kind_valid"
    add_column :order_deliveries, :invoice_number, :string, limit: 64
    add_check_constraint :order_deliveries, "kind IN ('received', 'dispatched', 'inbound', 'outbound')", name: "order_deliveries_kind_valid"
    add_check_constraint :order_deliveries, "kind <> 'dispatched' OR invoice_number IS NOT NULL", name: "order_deliveries_dispatch_invoice"

    add_column :vendors, :address, :text
    add_column :vendors, :gst, :string, limit: 32
    add_column :vendors, :phone, :string, limit: 40

    add_column :products, :customer_price, :decimal, precision: 15, scale: 4
    add_check_constraint :products, "customer_price IS NULL OR customer_price >= 0", name: "products_customer_price_valid"
    create_table :price_changes do |t|
      t.references :product, null: false, foreign_key: true
      t.references :vendor_product, foreign_key: { on_delete: :nullify }
      t.string :kind, null: false
      t.string :vendor_name
      t.decimal :old_amount, precision: 15, scale: 4
      t.decimal :new_amount, precision: 15, scale: 4
      t.decimal :old_set_amount, precision: 15, scale: 4
      t.decimal :new_set_amount, precision: 15, scale: 4
      t.string :currency, limit: 3
      t.string :source, null: false
      t.references :upload_batch, foreign_key: true
      t.references :changed_by, foreign_key: { to_table: :users }
      t.datetime :created_at, null: false
    end
    add_check_constraint :price_changes, "kind IN ('customer', 'vendor')", name: "price_changes_kind_valid"
    add_check_constraint :price_changes, "source IN ('upload', 'manual', 'import')", name: "price_changes_source_valid"
    add_index :price_changes, %i[product_id created_at]

    remove_check_constraint :notifications, name: "notifications_kind_valid"
    add_column :notifications, :ship_to_alert_count, :integer, null: false, default: 0
    add_check_constraint :notifications, "kind IN ('quantity_changes', 'address_changes', 'moq_alerts', 'ship_to_alerts')",
                         name: "notifications_kind_valid"
  end

  def down
    remove_check_constraint :notifications, name: "notifications_kind_valid"
    execute "DELETE FROM notifications WHERE kind = 'ship_to_alerts'"
    remove_column :notifications, :ship_to_alert_count
    add_check_constraint :notifications, "kind IN ('quantity_changes', 'address_changes', 'moq_alerts')", name: "notifications_kind_valid"

    drop_table :price_changes
    remove_check_constraint :products, name: "products_customer_price_valid"
    remove_column :products, :customer_price

    remove_column :vendors, :phone
    remove_column :vendors, :gst
    remove_column :vendors, :address

    remove_check_constraint :order_deliveries, name: "order_deliveries_dispatch_invoice"
    remove_check_constraint :order_deliveries, name: "order_deliveries_kind_valid"
    execute "DELETE FROM order_deliveries WHERE kind IN ('received', 'dispatched')"
    remove_column :order_deliveries, :invoice_number
    add_check_constraint :order_deliveries, "kind IN ('inbound', 'outbound')", name: "order_deliveries_kind_valid"
  end
end
