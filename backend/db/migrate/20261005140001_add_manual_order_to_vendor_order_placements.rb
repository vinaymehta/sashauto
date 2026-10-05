# Manual orders can be placed with vendors like imported order rows: a placement references either the
# imported order row (and its upload) or the manual order.
class AddManualOrderToVendorOrderPlacements < ActiveRecord::Migration[8.1]
  def up
    add_reference :vendor_order_placements, :manual_order, foreign_key: true
    change_column_null :vendor_order_placements, :order_row_id, true
    change_column_null :vendor_order_placements, :upload_batch_id, true
    add_check_constraint :vendor_order_placements,
                         "(manual_order_id IS NOT NULL AND order_row_id IS NULL AND upload_batch_id IS NULL) OR " \
                         "(manual_order_id IS NULL AND order_row_id IS NOT NULL AND upload_batch_id IS NOT NULL)",
                         name: "vendor_order_placements_one_order"
  end

  def down
    remove_check_constraint :vendor_order_placements, name: "vendor_order_placements_one_order"
    # Placements are locked (append-only); this cannot be reversed once a manual order was placed.
    change_column_null :vendor_order_placements, :upload_batch_id, false
    change_column_null :vendor_order_placements, :order_row_id, false
    remove_reference :vendor_order_placements, :manual_order
  end
end
