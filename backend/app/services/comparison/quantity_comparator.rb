module Comparison
  # Compares one version against the previous one entirely in PostgreSQL (join on the indexed
  # business-key hash), so neither version is loaded into Ruby memory.
  #
  # Rules: only rows present in both versions with a known effective quantity on both sides are
  # compared. New rows, removed rows and unknown quantities never produce change records.
  class QuantityComparator
    Stats = Data.define(:compared_count, :increase_count, :decrease_count, :unchanged_count,
                        :new_row_count, :missing_row_count)

    def self.call(current_batch_id:, previous_batch_id:)
      new(current_batch_id, previous_batch_id).call
    end

    def initialize(current_batch_id, previous_batch_id)
      @current = Integer(current_batch_id)
      @previous = Integer(previous_batch_id)
    end

    def call
      insert_changes
      stats
    end

    private

    def connection
      ActiveRecord::Base.connection
    end

    def sql(template)
      ActiveRecord::Base.sanitize_sql_array([ template, { current: @current, previous: @previous } ])
    end

    def insert_changes
      connection.execute(sql(<<~SQL))
        INSERT INTO quantity_changes (
          upload_batch_id, previous_upload_batch_id, order_snapshot_row_id, previous_order_snapshot_row_id,
          business_key_hash, ship_to_location, order_type, po_number, po_line_number, part_number, ship_date,
          commodity_type, old_qty, new_qty, difference, direction, created_at
        )
        SELECT n.upload_batch_id, o.upload_batch_id, n.id, o.id,
               n.business_key_hash, n.ship_to_location, n.order_type, n.po_number, n.po_line_number, n.part_number, n.ship_date,
               COALESCE(n.commodity_type, p.commodity_type), o.effective_qty, n.effective_qty, n.effective_qty - o.effective_qty,
               CASE WHEN n.effective_qty > o.effective_qty THEN 'increase' ELSE 'decrease' END,
               CURRENT_TIMESTAMP
        FROM order_snapshot_rows n
        JOIN order_snapshot_rows o
          ON o.upload_batch_id = :previous AND o.business_key_hash = n.business_key_hash
        LEFT JOIN products p ON p.part_number = n.part_number
        WHERE n.upload_batch_id = :current
          AND n.effective_qty IS NOT NULL
          AND o.effective_qty IS NOT NULL
          AND n.effective_qty <> o.effective_qty
      SQL
    end

    def stats
      row = connection.select_one(sql(<<~SQL))
        SELECT
          COUNT(o.id) FILTER (WHERE n.effective_qty IS NOT NULL AND o.effective_qty IS NOT NULL) AS compared_count,
          COUNT(*) FILTER (WHERE o.id IS NOT NULL AND n.effective_qty > o.effective_qty) AS increase_count,
          COUNT(*) FILTER (WHERE o.id IS NOT NULL AND n.effective_qty < o.effective_qty) AS decrease_count,
          COUNT(*) FILTER (WHERE o.id IS NOT NULL AND n.effective_qty = o.effective_qty) AS unchanged_count,
          COUNT(*) FILTER (WHERE o.id IS NULL) AS new_row_count,
          (SELECT COUNT(*) FROM order_snapshot_rows old_row
            WHERE old_row.upload_batch_id = :previous
              AND NOT EXISTS (SELECT 1 FROM order_snapshot_rows cur
                              WHERE cur.upload_batch_id = :current AND cur.business_key_hash = old_row.business_key_hash)
          ) AS missing_row_count
        FROM order_snapshot_rows n
        LEFT JOIN order_snapshot_rows o
          ON o.upload_batch_id = :previous AND o.business_key_hash = n.business_key_hash
        WHERE n.upload_batch_id = :current
      SQL
      Stats.new(**row.symbolize_keys.transform_values(&:to_i))
    end
  end
end
