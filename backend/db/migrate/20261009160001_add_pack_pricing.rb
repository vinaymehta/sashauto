# Parts can be sold in sets/packs ("(10)NUT", "Pack of 10 Pcs") as well as by the piece, each with its own price
# and MOQ (e.g. MOQ "2000 pcs (200 of 10 pcs)", price "₹12 per pc (₹60 per Set)").
#
#   pack_size        pieces in one set (1 = sold as single pieces)
#   moq / moq_sets   minimum order in pieces / in sets (one is derived from the other with pack_size)
#   price_amount / set_price_amount   vendor price per piece / per set (likewise)
#
# Order Qty is counted in sets. A vendor order is placed in sets or pieces (`unit`), which decides its price and
# the MOQ it is checked against. The unit is part of the locked allocation.
class AddPackPricing < ActiveRecord::Migration[8.1]
  def up
    add_column :products, :pack_size, :integer, null: false, default: 1
    add_column :products, :moq_sets, :decimal, precision: 15, scale: 3
    add_check_constraint :products, "pack_size >= 1", name: "products_pack_size_positive"
    add_check_constraint :products, "moq_sets IS NULL OR moq_sets > 0", name: "products_moq_sets_positive"

    add_column :vendor_products, :pack_size, :integer, null: false, default: 1
    add_column :vendor_products, :moq_sets, :decimal, precision: 15, scale: 3
    add_column :vendor_products, :set_price_amount, :decimal, precision: 15, scale: 4
    add_check_constraint :vendor_products, "pack_size >= 1", name: "vendor_products_pack_size_positive"
    add_check_constraint :vendor_products, "moq_sets IS NULL OR moq_sets > 0", name: "vendor_products_moq_sets_positive"
    add_check_constraint :vendor_products, "set_price_amount IS NULL OR set_price_amount >= 0", name: "vendor_products_set_price_valid"

    # Existing MOQs count as sets of one piece until the part is imported again with its pack size.
    execute "UPDATE products SET moq_sets = moq WHERE moq IS NOT NULL"
    execute "UPDATE vendor_products SET moq_sets = moq WHERE moq IS NOT NULL"
    execute "UPDATE vendor_products SET set_price_amount = price_amount WHERE price_amount IS NOT NULL"

    add_column :vendor_orders, :unit, :string, null: false, default: "sets"
    add_check_constraint :vendor_orders, "unit IN ('sets', 'pcs')", name: "vendor_orders_unit_valid"
    execute <<~SQL
      CREATE OR REPLACE FUNCTION reject_vendor_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.vendor_order_placement_id IS DISTINCT FROM OLD.vendor_order_placement_id
           OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.number IS DISTINCT FROM OLD.number
           OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.unit IS DISTINCT FROM OLD.unit OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.price_currency IS DISTINCT FROM OLD.price_currency OR NEW.price_note IS DISTINCT FROM OLD.price_note
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'placed vendor orders are locked: % of the allocation is not allowed', TG_OP;
        END IF;
        RETURN NEW;
      END;
      $$;
    SQL
  end

  def down
    execute <<~SQL
      CREATE OR REPLACE FUNCTION reject_vendor_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
    SQL
    remove_check_constraint :vendor_orders, name: "vendor_orders_unit_valid"
    remove_column :vendor_orders, :unit
    remove_check_constraint :vendor_products, name: "vendor_products_set_price_valid"
    remove_check_constraint :vendor_products, name: "vendor_products_moq_sets_positive"
    remove_check_constraint :vendor_products, name: "vendor_products_pack_size_positive"
    remove_column :vendor_products, :set_price_amount
    remove_column :vendor_products, :moq_sets
    remove_column :vendor_products, :pack_size
    remove_check_constraint :products, name: "products_moq_sets_positive"
    remove_check_constraint :products, name: "products_pack_size_positive"
    remove_column :products, :moq_sets
    remove_column :products, :pack_size
  end
end
