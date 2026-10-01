# Vendors and the parts they supply. A Part Number (product) can have several vendors, each with its own
# vendor part number, MOQ, weight and price (amount + currency + optional note such as "EX CHINA").
class CreateVendors < ActiveRecord::Migration[8.1]
  def change
    create_table :vendors do |t|
      t.string :name, null: false
      t.timestamps
    end
    add_index :vendors, "lower(name)", unique: true, name: "index_vendors_on_lower_name"

    create_table :vendor_products do |t|
      t.references :vendor, null: false, foreign_key: { on_delete: :cascade }
      t.references :product, null: false, foreign_key: true
      t.string :sash_part
      t.string :vendor_part
      t.text :description
      t.decimal :moq, precision: 15, scale: 3
      t.decimal :weight_kg, precision: 12, scale: 4
      t.decimal :price_amount, precision: 15, scale: 4
      t.string :price_currency, null: false, default: "INR", limit: 3
      t.string :price_note
      t.timestamps
    end
    add_index :vendor_products, [ :vendor_id, :product_id ], unique: true
    add_check_constraint :vendor_products, "moq IS NULL OR moq > 0", name: "vendor_products_moq_positive"
    add_check_constraint :vendor_products, "weight_kg IS NULL OR weight_kg >= 0", name: "vendor_products_weight_valid"
    add_check_constraint :vendor_products, "price_amount IS NULL OR price_amount >= 0", name: "vendor_products_price_valid"
    add_check_constraint :vendor_products, "price_currency IN ('INR', 'USD', 'EUR', 'CNY')", name: "vendor_products_currency_valid"
  end
end
