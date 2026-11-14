# A vendor PO recorded from an uploaded list keeps the order row it was listed on (its own order key; a combined
# order's placement is on its first row), so uploading the list again finds "the same row" even inside a combined order.
class AddSourceOrderKeyToVendorOrders < ActiveRecord::Migration[8.1]
  def up
    add_column :vendor_orders, :source_order_key, :string, limit: 64
    add_index :vendor_orders, :source_order_key
    execute <<~SQL
      UPDATE vendor_orders SET source_order_key = p.order_key
      FROM vendor_order_placements p WHERE p.id = vendor_orders.vendor_order_placement_id AND vendor_orders.source = 'file'
    SQL
  end

  def down
    remove_column :vendor_orders, :source_order_key
  end
end
