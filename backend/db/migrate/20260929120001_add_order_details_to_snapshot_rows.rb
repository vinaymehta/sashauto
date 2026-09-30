# Display-only columns from the Supplier Requirements export, shown on the Orders page.
# Rows are append-only; the trigger is narrowed so the ONLY permitted update is filling these new
# columns while they are still NULL (backfill from the stored original file). Every other column,
# and any detail value once set, stays immutable.
class AddOrderDetailsToSnapshotRows < ActiveRecord::Migration[8.1]
  DETAIL_COLUMNS = {
    due_date: :date, unit: :string, plant_code: :string,
    last_asn_qty: :decimal, last_asn_date: :date, last_receipt_qty: :decimal, last_receipt_date: :date,
    last_packing_list_number: :string, crossdock_location: :string, dock_number: :string,
    supplier_part_number: :string, last_released_date: :date, last_updated_date: :date
  }.freeze

  CORE_COLUMNS = %w[id upload_batch_id business_key_hash ship_to_location order_type po_number po_line_number
                    part_number ship_date commodity_type qty previous_qty effective_qty quantity_source
                    current_release_number current_release_date source_row_numbers created_at].freeze

  def up
    DETAIL_COLUMNS.each do |name, type|
      options = type == :decimal ? { precision: 15, scale: 3 } : {}
      add_column :order_snapshot_rows, name, type, **options
    end
    add_column :order_snapshot_rows, :details_loaded, :boolean, null: false, default: false

    # Sorting on the Orders page (always scoped to one upload).
    add_index :order_snapshot_rows, [ :upload_batch_id, :ship_date ], name: "index_snapshot_rows_on_batch_and_ship_date"
    add_index :order_snapshot_rows, [ :upload_batch_id, :po_number, :po_line_number ], name: "index_snapshot_rows_on_batch_and_po"
    add_index :order_snapshot_rows, [ :upload_batch_id, :part_number ], name: "index_snapshot_rows_on_batch_and_part"

    core_changed = CORE_COLUMNS.map { |c| "NEW.#{c} IS DISTINCT FROM OLD.#{c}" }.join(" OR ")
    detail_rewritten = DETAIL_COLUMNS.keys.map { |c| "(OLD.#{c} IS NOT NULL AND NEW.#{c} IS DISTINCT FROM OLD.#{c})" }.join(" OR ")

    execute <<~SQL
      CREATE FUNCTION protect_snapshot_rows() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'DELETE on order_snapshot_rows is not allowed: historical records are immutable';
        END IF;
        IF OLD.details_loaded OR #{core_changed} OR #{detail_rewritten} THEN
          RAISE EXCEPTION 'UPDATE on order_snapshot_rows is not allowed: historical records are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER order_snapshot_rows_append_only ON order_snapshot_rows;
      CREATE TRIGGER order_snapshot_rows_append_only
        BEFORE UPDATE OR DELETE ON order_snapshot_rows
        FOR EACH ROW EXECUTE FUNCTION protect_snapshot_rows();
    SQL
  end

  def down
    execute <<~SQL
      DROP TRIGGER order_snapshot_rows_append_only ON order_snapshot_rows;
      CREATE TRIGGER order_snapshot_rows_append_only
        BEFORE UPDATE OR DELETE ON order_snapshot_rows
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
      DROP FUNCTION protect_snapshot_rows();
    SQL
    remove_index :order_snapshot_rows, name: "index_snapshot_rows_on_batch_and_part"
    remove_index :order_snapshot_rows, name: "index_snapshot_rows_on_batch_and_po"
    remove_index :order_snapshot_rows, name: "index_snapshot_rows_on_batch_and_ship_date"
    remove_column :order_snapshot_rows, :details_loaded
    DETAIL_COLUMNS.each_key { |name| remove_column :order_snapshot_rows, name }
  end
end
