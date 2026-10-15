# An order can be ordered in parts: each Generate PO orders some of the Qty (allocated_qty, in sets) and the rest
# stays open for later POs. Placements from before this were for the whole order (allocated_qty NULL = order_qty).
class AllowSeveralPosPerOrder < ActiveRecord::Migration[8.1]
  def change
    remove_index :vendor_order_placements, :order_key, unique: true
    add_index :vendor_order_placements, :order_key
    add_column :vendor_order_placements, :allocated_qty, :decimal, precision: 15, scale: 3
    add_check_constraint :vendor_order_placements, "allocated_qty IS NULL OR allocated_qty > 0", name: "vendor_order_placements_allocated_positive"
  end
end
