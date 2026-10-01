module Comparison
  # Compares one upload against the previous one entirely in PostgreSQL.
  #
  # Unit of comparison: EVERY order row, matched with the previous upload by PO Number + Part Number +
  # Type + Ship Date (see RowMatching). A matched pair whose rows both have a known effective quantity
  # is compared; a different quantity creates a change. New rows, rows that disappeared, and unknown
  # quantities never produce change records.
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
        #{RowMatching.ctes}
        INSERT INTO quantity_changes (
          upload_batch_id, previous_upload_batch_id, order_row_id, previous_order_row_id,
          business_key_hash, ship_to_location, order_type, po_number, po_line_number, part_number, ship_date,
          commodity_type, old_qty, new_qty, difference, direction, created_at
        )
        SELECT n.upload_batch_id, o.upload_batch_id, n.id, o.id,
               encode(sha256(convert_to(n.group_key || '|' || n.ship_date::text || '|' || n.occ::text, 'UTF8')), 'hex'),
               n.ship_to_location, n.order_type, n.po_number, n.po_line_number, n.part_number, n.ship_date,
               COALESCE(n.commodity_type, p.commodity_type), o.effective_qty, n.effective_qty, n.effective_qty - o.effective_qty,
               CASE WHEN n.effective_qty > o.effective_qty THEN 'increase' ELSE 'decrease' END,
               CURRENT_TIMESTAMP
        FROM n
        JOIN o ON #{RowMatching::JOIN}
        LEFT JOIN products p ON p.part_number = n.part_number
        WHERE n.effective_qty IS NOT NULL
          AND o.effective_qty IS NOT NULL
          AND n.effective_qty <> o.effective_qty
      SQL
    end

    def stats
      row = connection.select_one(sql(<<~SQL))
        #{RowMatching.ctes}
        SELECT
          COUNT(o.id) FILTER (WHERE n.effective_qty IS NOT NULL AND o.effective_qty IS NOT NULL) AS compared_count,
          COUNT(*) FILTER (WHERE o.id IS NOT NULL AND n.effective_qty > o.effective_qty) AS increase_count,
          COUNT(*) FILTER (WHERE o.id IS NOT NULL AND n.effective_qty < o.effective_qty) AS decrease_count,
          COUNT(*) FILTER (WHERE o.id IS NOT NULL AND n.effective_qty = o.effective_qty) AS unchanged_count,
          COUNT(*) FILTER (WHERE o.id IS NULL) AS new_row_count,
          (SELECT COUNT(*) FROM o WHERE NOT EXISTS (SELECT 1 FROM n WHERE #{RowMatching::JOIN})) AS missing_row_count
        FROM n
        LEFT JOIN o ON #{RowMatching::JOIN}
      SQL
      Stats.new(**row.symbolize_keys.transform_values(&:to_i))
    end
  end
end
