# Historical records are append-only. These triggers enforce it in the database so that
# no code path (console, bulk SQL, future bug) can rewrite history.
class EnforceHistoryImmutability < ActiveRecord::Migration[8.1]
  APPEND_ONLY_TABLES = %w[order_snapshot_rows quantity_changes audit_logs].freeze

  def up
    execute <<~SQL
      CREATE FUNCTION reject_history_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% on % is not allowed: historical records are immutable', TG_OP, TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;

      CREATE FUNCTION protect_finished_upload_batches() RETURNS trigger AS $$
      BEGIN
        IF OLD.status IN ('completed', 'failed') THEN
          RAISE EXCEPTION '% of % upload batch % is not allowed', TG_OP, OLD.status, OLD.id;
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER upload_batches_protect_finished
        BEFORE UPDATE OR DELETE ON upload_batches
        FOR EACH ROW EXECUTE FUNCTION protect_finished_upload_batches();
    SQL

    APPEND_ONLY_TABLES.each do |table|
      execute <<~SQL
        CREATE TRIGGER #{table}_append_only
          BEFORE UPDATE OR DELETE ON #{table}
          FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
      SQL
    end
  end

  def down
    APPEND_ONLY_TABLES.each { |table| execute "DROP TRIGGER #{table}_append_only ON #{table}" }
    execute "DROP TRIGGER upload_batches_protect_finished ON upload_batches"
    execute "DROP FUNCTION protect_finished_upload_batches()"
    execute "DROP FUNCTION reject_history_mutation()"
  end
end
