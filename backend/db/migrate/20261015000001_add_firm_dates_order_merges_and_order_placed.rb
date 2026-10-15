# Manager feedback (Oct 2026):
# - Vendor POs are no longer emailed from the app; an admin ticks "Order placed" on each generated PO instead.
# - Firm Date: the day an order (or combined order) first reached the part's MOQ, kept across uploads.
# - An admin can add more orders by hand to a combined order that reached the MOQ.
class AddFirmDatesOrderMergesAndOrderPlaced < ActiveRecord::Migration[8.1]
  def change
    add_column :vendor_orders, :order_placed_at, :datetime
    add_reference :vendor_orders, :order_placed_by, foreign_key: { to_table: :users }

    create_table :order_firm_dates do |t|
      t.string :order_key, limit: 64, null: false, index: { unique: true }
      t.date :firm_on, null: false
      t.timestamps
    end

    # Orders matched by order key (VendorOrderPlacement.order_key), so a merge carries over to later uploads.
    create_table :order_merges do |t|
      t.string :anchor_key, limit: 64, null: false, index: true
      t.string :member_key, limit: 64, null: false, index: { unique: true }
      t.string :group_key, null: false, index: true
      t.references :added_by, null: false, foreign_key: { to_table: :users }
      t.timestamps
    end
  end
end
