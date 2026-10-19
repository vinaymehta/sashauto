# "Available Parts": how many pieces of the part the vendor has available now (entered with the vendor's part).
class AddAvailableQtyToVendorProducts < ActiveRecord::Migration[8.1]
  def change
    add_column :vendor_products, :available_qty, :decimal, precision: 15, scale: 3
    add_check_constraint :vendor_products, "available_qty IS NULL OR available_qty >= 0", name: "vendor_products_available_qty_non_negative"
  end
end
