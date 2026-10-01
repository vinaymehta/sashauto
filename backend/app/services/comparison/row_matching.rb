module Comparison
  # Pairs EVERY order row of an upload with the same row of the previous upload: same PO Number +
  # Part Number + Type (group_key) and same Ship Date. When a file has that key more than once, rows
  # are paired in Excel row order (1st with 1st, 2nd with 2nd). Rows without a partner are new/missing.
  module RowMatching
    module_function

    # SQL defining CTEs `n` (current upload) and `o` (previous upload), each with `occ`, the
    # occurrence number of the row within its PO + Part + Type + Ship Date. Uses :current / :previous.
    def ctes
      <<~SQL
        WITH n AS (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.group_key, r.ship_date ORDER BY r.source_row_number) AS occ
          FROM order_rows r WHERE r.upload_batch_id = :current
        ), o AS (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.group_key, r.ship_date ORDER BY r.source_row_number) AS occ
          FROM order_rows r WHERE r.upload_batch_id = :previous
        )
      SQL
    end

    JOIN = "o.group_key = n.group_key AND o.ship_date = n.ship_date AND o.occ = n.occ".freeze
  end
end
