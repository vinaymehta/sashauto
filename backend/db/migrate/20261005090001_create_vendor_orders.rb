# Vendor orders: the buyer splits one order row's Qty among vendors linked to its Part Number and places one
# Vendor Order per vendor. A placement happens once per order row (identified across uploads by
# PO Number + Part Number + Type + PO Line Number + Ship Date). After placement the allocation is locked
# (database trigger); only the email delivery columns can change. Vendor Order Numbers come from a sequence.
class CreateVendorOrders < ActiveRecord::Migration[8.1]
  def up
    add_column :vendors, :email, :string

    create_table :vendor_order_placements do |t|
      t.string :order_key, null: false, limit: 64
      t.references :order_row, null: false, foreign_key: true
      t.references :upload_batch, null: false, foreign_key: true
      t.references :product, foreign_key: true
      t.string :po_number, null: false
      t.string :po_line_number, null: false
      t.string :part_number, null: false
      t.string :order_type, null: false
      t.date :ship_date, null: false
      t.date :due_date
      t.string :unit
      t.decimal :order_qty, precision: 15, scale: 3, null: false
      t.decimal :moq, precision: 15, scale: 3
      t.references :placed_by, null: false, foreign_key: { to_table: :users }
      t.datetime :placed_at, null: false
      t.timestamps
    end
    add_index :vendor_order_placements, :order_key, unique: true

    execute "CREATE SEQUENCE vendor_order_number_seq START 1"
    create_table :vendor_orders do |t|
      t.references :vendor_order_placement, null: false, foreign_key: true
      t.references :vendor, null: false, foreign_key: true
      t.string :number, null: false
      t.decimal :qty, precision: 15, scale: 3, null: false
      t.decimal :unit_price, precision: 15, scale: 4
      t.string :price_currency, limit: 3
      t.string :price_note
      t.string :email_status, null: false, default: "pending"
      t.string :email_recipient
      t.integer :email_attempts, null: false, default: 0
      t.text :email_last_error
      t.datetime :email_last_attempt_at
      t.datetime :email_sent_at
      t.string :email_provider_message_id
      t.timestamps
    end
    add_index :vendor_orders, :number, unique: true
    add_index :vendor_orders, [ :vendor_order_placement_id, :vendor_id ], unique: true
    add_check_constraint :vendor_orders, "qty > 0", name: "vendor_orders_qty_positive"
    add_check_constraint :vendor_orders, "email_status IN ('pending', 'sent', 'failed', 'no_email')", name: "vendor_orders_email_status_valid"
    add_check_constraint :vendor_order_placements, "order_qty > 0", name: "vendor_order_placements_qty_positive"

    # Placed orders are locked: placements never change; on vendor orders only the email columns may change.
    execute <<~SQL
      CREATE TRIGGER vendor_order_placements_locked
        BEFORE UPDATE OR DELETE ON vendor_order_placements
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

      CREATE FUNCTION reject_vendor_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.vendor_order_placement_id IS DISTINCT FROM OLD.vendor_order_placement_id
           OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.number IS DISTINCT FROM OLD.number
           OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.price_currency IS DISTINCT FROM OLD.price_currency OR NEW.price_note IS DISTINCT FROM OLD.price_note
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'placed vendor orders are locked: % of the allocation is not allowed', TG_OP;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER vendor_orders_locked
        BEFORE UPDATE OR DELETE ON vendor_orders
        FOR EACH ROW EXECUTE FUNCTION reject_vendor_order_change();
    SQL
  end

  def down
    drop_table :vendor_orders
    execute "DROP FUNCTION reject_vendor_order_change()"
    execute "DROP SEQUENCE vendor_order_number_seq"
    drop_table :vendor_order_placements
    remove_column :vendors, :email
  end
end
