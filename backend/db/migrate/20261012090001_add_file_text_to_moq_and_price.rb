# The MOQ and price exactly as written in the vendor file ("200 of 10 pcs", "₹12 per pc (₹60 per Set)"), shown
# instead of the parsed numbers. Cleared when the numbers are edited by hand.
class AddFileTextToMoqAndPrice < ActiveRecord::Migration[8.1]
  def change
    add_column :products, :moq_text, :string, limit: 200
    add_column :vendor_products, :moq_text, :string, limit: 200
    add_column :vendor_products, :price_text, :string, limit: 200
  end
end
