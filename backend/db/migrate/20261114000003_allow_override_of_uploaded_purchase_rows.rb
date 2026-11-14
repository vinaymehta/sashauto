# Purchase orders uploads: a row uploaded again with other values (Qty, vendor PO number) is offered for override.
# Placements and vendor orders stay locked, except those recorded from an uploaded vendor PO list: their vendor PO
# number and Qty (and the placement's Qty ordered) may then change. `conflicts` keeps such rows of an upload until
# they are overridden or kept.
class AllowOverrideOfUploadedPurchaseRows < ActiveRecord::Migration[8.1]
  def up
    add_column :vendor_po_imports, :conflicts, :jsonb, null: false, default: []
    execute <<~SQL
      CREATE OR REPLACE FUNCTION reject_vendor_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.vendor_order_placement_id IS DISTINCT FROM OLD.vendor_order_placement_id
           OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
           OR (OLD.source <> 'file' AND (NEW.number IS DISTINCT FROM OLD.number OR NEW.qty IS DISTINCT FROM OLD.qty))
           OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
           OR NEW.price_currency IS DISTINCT FROM OLD.price_currency OR NEW.price_note IS DISTINCT FROM OLD.price_note
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'placed vendor orders are locked: % of the allocation is not allowed', TG_OP;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE FUNCTION reject_placement_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND OLD.vendor_po_import_id IS NOT NULL AND NEW.id = OLD.id AND NEW.order_key = OLD.order_key
           AND NEW.order_row_id IS NOT DISTINCT FROM OLD.order_row_id AND NEW.created_at = OLD.created_at THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '% on % is not allowed: historical records are immutable', TG_OP, TG_TABLE_NAME;
      END;
      $$;

      DROP TRIGGER vendor_order_placements_locked ON vendor_order_placements;
      CREATE TRIGGER vendor_order_placements_locked
        BEFORE UPDATE OR DELETE ON vendor_order_placements
        FOR EACH ROW EXECUTE FUNCTION reject_placement_change();
    SQL
  end

  def down
    execute <<~SQL
      DROP TRIGGER vendor_order_placements_locked ON vendor_order_placements;
      CREATE TRIGGER vendor_order_placements_locked
        BEFORE UPDATE OR DELETE ON vendor_order_placements
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
      DROP FUNCTION reject_placement_change();
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
    remove_column :vendor_po_imports, :conflicts
  end
end
