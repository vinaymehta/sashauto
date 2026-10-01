# Address changes are now detected on every order row (not only the current row of each
# PO Number + Part Number + Type), so one upload can have several per group.
class AddressChangesPerRow < ActiveRecord::Migration[8.1]
  def change
    remove_index :address_changes, [ :upload_batch_id, :group_key ], unique: true, name: "index_address_changes_on_batch_and_group"
    add_index :address_changes, [ :upload_batch_id, :order_row_id ], unique: true, name: "index_address_changes_on_batch_and_row"
  end
end
