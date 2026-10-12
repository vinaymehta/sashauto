# Vendor prices may also be in British pounds (GBP), e.g. "GBP 4.04" in the GMBH vendor workbook.
class AddGbpToVendorProductCurrencies < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :vendor_products, name: "vendor_products_currency_valid"
    add_check_constraint :vendor_products, "price_currency IN ('INR', 'USD', 'EUR', 'CNY', 'GBP')", name: "vendor_products_currency_valid"
  end

  def down
    remove_check_constraint :vendor_products, name: "vendor_products_currency_valid"
    add_check_constraint :vendor_products, "price_currency IN ('INR', 'USD', 'EUR', 'CNY')", name: "vendor_products_currency_valid"
  end
end
