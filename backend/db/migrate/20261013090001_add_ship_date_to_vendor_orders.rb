# Each vendor order can have its own ship date, chosen when placing (defaults to the order's Ship Date). Locked
# after placing like the rest of the allocation.
class AddShipDateToVendorOrders < ActiveRecord::Migration[8.1]
  def up
    add_column :vendor_orders, :ship_date, :date
    lock_function("OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.unit IS DISTINCT FROM OLD.unit OR NEW.ship_date IS DISTINCT FROM OLD.ship_date")
  end

  def down
    lock_function("OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.unit IS DISTINCT FROM OLD.unit")
    remove_column :vendor_orders, :ship_date
  end

  private

  def lock_function(qty_line)
    execute <<~SQL
      CREATE OR REPLACE FUNCTION reject_vendor_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.vendor_order_placement_id IS DISTINCT FROM OLD.vendor_order_placement_id
           OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.number IS DISTINCT FROM OLD.number
           #{qty_line} OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.price_currency IS DISTINCT FROM OLD.price_currency OR NEW.price_note IS DISTINCT FROM OLD.price_note
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'placed vendor orders are locked: % of the allocation is not allowed', TG_OP;
        END IF;
        RETURN NEW;
      END;
      $$;
    SQL
  end
end
