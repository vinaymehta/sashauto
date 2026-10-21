# The "Available" tick of vendor parts is dropped: the Available Parts quantity (available_qty) says it already.
class RemoveAvailabilityTickFromVendorProducts < ActiveRecord::Migration[8.1]
  def change
    remove_index :vendor_products, :available
    remove_reference :vendor_products, :available_changed_by, foreign_key: { to_table: :users }, index: false
    remove_column :vendor_products, :available_changed_at, :datetime
    remove_column :vendor_products, :available, :boolean, null: false, default: false
  end
end
