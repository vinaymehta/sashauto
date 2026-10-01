# MOQ (minimum order quantity) per Part Number on products, and the current order rows
# (latest Ship Date per PO Number + Part Number + Type) whose Qty was below MOQ in an upload.
# A row is `new_alert` when its group was not already below MOQ in the previous upload; only those
# are emailed. Append-only, like the other comparison results.
class AddMoqAndCreateMoqAlerts < ActiveRecord::Migration[8.1]
  def up
    add_column :products, :moq, :decimal, precision: 15, scale: 3
    add_check_constraint :products, "moq IS NULL OR moq > 0", name: "products_moq_positive"

    create_table :moq_alerts do |t|
      t.references :upload_batch, null: false, foreign_key: true, index: false
      t.references :order_row, null: false, foreign_key: true
      t.references :product, null: false, foreign_key: true
      t.string :group_key, null: false, limit: 64
      t.string :po_number, null: false
      t.string :part_number, null: false
      t.string :order_type, null: false
      t.date :ship_date, null: false
      t.decimal :qty, precision: 15, scale: 3, null: false
      t.decimal :moq, precision: 15, scale: 3, null: false
      t.boolean :new_alert, null: false
      t.datetime :created_at, null: false
    end
    add_index :moq_alerts, [ :upload_batch_id, :group_key ], unique: true, name: "index_moq_alerts_on_batch_and_group"
    add_index :moq_alerts, [ :upload_batch_id, :new_alert ], name: "index_moq_alerts_on_batch_and_new"
    execute <<~SQL
      CREATE TRIGGER moq_alerts_append_only
        BEFORE UPDATE OR DELETE ON moq_alerts
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
    SQL

    add_column :upload_batches, :moq_alert_count, :integer
    add_column :notifications, :moq_alert_count, :integer, null: false, default: 0
  end

  def down
    remove_column :notifications, :moq_alert_count
    remove_column :upload_batches, :moq_alert_count
    execute "DROP TRIGGER moq_alerts_append_only ON moq_alerts"
    drop_table :moq_alerts
    remove_check_constraint :products, name: "products_moq_positive"
    remove_column :products, :moq
  end
end
