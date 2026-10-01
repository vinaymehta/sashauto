module Comparison
  # Detects Ship To Address changes, in PostgreSQL, on the same unit as quantity comparison: the
  # CURRENT row of each PO Number + Part Number + Type group present in both uploads. New and missing
  # groups are ignored. Addresses are compared after trimming and collapsing whitespace (the export
  # pads cells with spaces); the stored old/new values are the trimmed originals. Returns the count.
  class AddressComparator
    ADDRESS = "regexp_replace(btrim(coalesce(%<alias>s.source_data->>'Ship To Address', '')), '\\s+', ' ', 'g')".freeze

    def self.call(current_batch_id:, previous_batch_id:)
      new_addr = format(ADDRESS, alias: "n")
      old_addr = format(ADDRESS, alias: "o")
      sql = ActiveRecord::Base.sanitize_sql_array([ <<~SQL, { current: Integer(current_batch_id), previous: Integer(previous_batch_id) } ])
        INSERT INTO address_changes (
          upload_batch_id, previous_upload_batch_id, order_row_id, previous_order_row_id, group_key,
          po_number, part_number, order_type, ship_date, old_address, new_address, created_at
        )
        SELECT n.upload_batch_id, o.upload_batch_id, n.id, o.id, n.group_key,
               n.po_number, n.part_number, n.order_type, n.ship_date,
               NULLIF(#{old_addr}, ''), NULLIF(#{new_addr}, ''), CURRENT_TIMESTAMP
        FROM order_rows n
        JOIN order_rows o
          ON o.upload_batch_id = :previous AND o.current AND o.group_key = n.group_key
        WHERE n.upload_batch_id = :current AND n.current
          AND #{new_addr} <> #{old_addr}
      SQL
      ActiveRecord::Base.connection.execute(sql).cmd_tuples
    end
  end
end
