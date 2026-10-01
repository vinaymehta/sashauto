module Comparison
  # Finds, in PostgreSQL, the CURRENT rows (latest Ship Date per PO Number + Part Number + Type) of an
  # upload whose Qty is below the Part Number's MOQ. Rows without a Qty and parts without an MOQ are
  # skipped; Qty >= MOQ is fine. Every row below MOQ is alerted on every upload (`new_alert` only
  # records whether it was already below MOQ in the previous upload). Returns the number of alerts.
  class MoqChecker
    def self.call(current_batch_id:, previous_batch_id: nil)
      binds = { current: Integer(current_batch_id), previous: previous_batch_id && Integer(previous_batch_id) }
      sql = ActiveRecord::Base.sanitize_sql_array([ <<~SQL, binds ])
        INSERT INTO moq_alerts (
          upload_batch_id, order_row_id, product_id, group_key, po_number, part_number, order_type,
          ship_date, qty, moq, new_alert, created_at
        )
        SELECT r.upload_batch_id, r.id, p.id, r.group_key, r.po_number, r.part_number, r.order_type,
               r.ship_date, r.qty, p.moq,
               NOT EXISTS (SELECT 1 FROM moq_alerts a WHERE a.upload_batch_id = :previous AND a.group_key = r.group_key),
               CURRENT_TIMESTAMP
        FROM order_rows r
        JOIN products p ON p.part_number = r.part_number
        WHERE r.upload_batch_id = :current AND r.current
          AND r.qty IS NOT NULL AND p.moq IS NOT NULL AND r.qty < p.moq
      SQL
      ActiveRecord::Base.connection.execute(sql).cmd_tuples
    end
  end
end
