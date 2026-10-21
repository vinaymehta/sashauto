# Drops indexes no query needs: three whose columns lead a wider index on the same table (that index serves the same
# lookups), and the snapshot rows' (batch, key) index, which no query uses (only written on every upload).
class RemoveUnneededIndexes < ActiveRecord::Migration[8.1]
  def change
    remove_index :vendor_products, :vendor_id, name: "index_vendor_products_on_vendor_id"
    remove_index :vendor_orders, :vendor_order_placement_id, name: "index_vendor_orders_on_vendor_order_placement_id"
    remove_index :price_changes, :product_id, name: "index_price_changes_on_product_id"
    remove_index :order_snapshot_rows, %i[upload_batch_id business_key_hash], name: "index_order_snapshot_rows_on_batch_and_key"
  end
end
