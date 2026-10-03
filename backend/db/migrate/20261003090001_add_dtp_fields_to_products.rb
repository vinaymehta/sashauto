# Product details from the DTP sheet (Customer Part = Part Number): SASH Part, Vendor Part, Description
# and Per Pc Weight in Kg. MOQ already lives on products.
class AddDtpFieldsToProducts < ActiveRecord::Migration[8.1]
  def change
    add_column :products, :sash_part, :string
    add_column :products, :vendor_part, :string
    add_column :products, :description, :text
    add_column :products, :weight_kg, :decimal, precision: 12, scale: 4
    add_check_constraint :products, "weight_kg IS NULL OR weight_kg >= 0", name: "products_weight_valid"
  end
end
