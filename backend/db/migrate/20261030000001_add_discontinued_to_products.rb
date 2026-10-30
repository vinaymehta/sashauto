# A discontinued part: no more vendor POs are placed for it (Generate PO is refused, it is left out of the MOQ check).
# Set by a product file whose Vendor Name says "Discontinue Part", or by hand on the Products page.
class AddDiscontinuedToProducts < ActiveRecord::Migration[8.1]
  def change
    add_column :products, :discontinued, :boolean, null: false, default: false
  end
end
