# Overseas vendors were all saved with the default currency INR (the vendor details file has no currency column), and
# Stonkam's prices, written without a currency in its price file, were read as INR. Sets each overseas vendor's real
# currency (by its country) and Stonkam's prices to USD. Only values still at INR are changed.
class FixOverseasVendorCurrencies < ActiveRecord::Migration[8.1]
  CURRENCIES = {
    "GBP" => [ "AP Air Europe Ltd", "DLI SEALS LTD", "Industrial Brakes Limited", "Presco Radiator Caps", "Wai-UK Ltd" ],
    "EUR" => [ "Matisa" ],
    "USD" => [ "Bei Bei Safety Co., Ltd", "Hangzhou Holdwell Mechanical & Electrical Co.Ltd", "Ruian Allright Automobile Parts Co. Ltd",
               "Stonkam Co., Ltd", "Wuxi Hongba Mechanical Electrical Equipment Co., Ltd.", "Zhejiang Fonho Automotive Co. Ltd.",
               "Zhejiang Shenlong Chain Transmission Co., Ltd." ]
  }.freeze

  def up
    CURRENCIES.each do |currency, names|
      execute(sanitize([ "UPDATE vendors SET currency = ?, updated_at = NOW() WHERE currency = 'INR' AND name IN (?)", currency, names ]))
    end
    execute(<<~SQL.squish)
      UPDATE vendor_products SET price_currency = 'USD', updated_at = NOW()
      WHERE price_currency = 'INR' AND vendor_id IN (SELECT id FROM vendors WHERE name = 'Stonkam Co., Ltd')
    SQL
  end

  def down
    # Data correction: the earlier INR values were wrong, so they are not restored.
  end

  private

  def sanitize(sql) = ActiveRecord::Base.sanitize_sql_array(sql)
end
