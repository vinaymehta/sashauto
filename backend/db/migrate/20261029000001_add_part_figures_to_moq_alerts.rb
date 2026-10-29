# MOQ alerts per part, as SASH checks them: the Firm Qty of all the part's open orders in the upload, the Qty already on
# vendor POs, Deere's received Qty, and Qty = the balance still to order (Firm - PO issued), alerted when it is below
# the MOQ. Earlier alerts (per order) and manual order alerts leave them blank.
class AddPartFiguresToMoqAlerts < ActiveRecord::Migration[8.1]
  def change
    change_table :moq_alerts, bulk: true do |t|
      t.decimal :firm_qty, precision: 15, scale: 3
      t.decimal :po_issued_qty, precision: 15, scale: 3
      t.decimal :received_qty, precision: 15, scale: 3
      t.string :description
      t.string :sash_part
    end
  end
end
