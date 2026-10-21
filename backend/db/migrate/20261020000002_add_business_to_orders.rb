# SASH works for two Deere suppliers, DTP and GMBH, whose order data is kept apart: every upload and manual order
# belongs to one of them (rows, changes, alerts, POs and marks follow their upload or manual order). Existing data is DTP.
class AddBusinessToOrders < ActiveRecord::Migration[8.1]
  def change
    %i[upload_batches manual_orders].each do |table|
      add_column table, :business, :string, null: false, default: "dtp"
      add_check_constraint table, "business IN ('dtp', 'gmbh')", name: "#{table}_business_valid"
      add_index table, :business
    end
  end
end
