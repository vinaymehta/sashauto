# "Available" tick per vendor part: the vendor confirmed it can supply that part now (the manager's check list), with
# who ticked or unticked it and when.
class AddAvailabilityToVendorProducts < ActiveRecord::Migration[8.1]
  def change
    add_column :vendor_products, :available, :boolean, null: false, default: false
    add_column :vendor_products, :available_changed_at, :datetime
    add_reference :vendor_products, :available_changed_by, foreign_key: { to_table: :users }, index: false
    add_index :vendor_products, :available
  end
end
