module Comparison
  # Compares one upload against the previous one.
  #
  # Unit of comparison: PO Number + PO Line Number + Part Number + Ship Date, with the Qty of all rows of that key
  # added up (a blank Qty counts as 0; rows listed twice are counted once as their sum). Each key whose Qty differs is
  # a change: increase/decrease (key in both), added (only in this upload, old Qty 0) or removed (only in the
  # previous upload, new Qty 0). Type and Ship To are taken from the key's first row.
  #
  # Reschedules: when, on the same PO line, one Ship Date drops to 0 and another goes from 0 to the same Qty, the
  # quantity only moved. The pair is recorded as ONE "rescheduled" change (new date, old date in
  # previous_ship_date, difference 0) and counted apart from the Qty changes. Dates are paired in date order.
  class QuantityComparator
    Stats = Data.define(:compared_count, :increase_count, :decrease_count, :unchanged_count,
                        :new_row_count, :missing_row_count, :rescheduled_count)

    def self.call(current_batch_id:, previous_batch_id:)
      new(current_batch_id, previous_batch_id).call
    end

    def initialize(current_batch_id, previous_batch_id)
      @current = Integer(current_batch_id)
      @previous = Integer(previous_batch_id)
    end

    def call
      records = pair_reschedules(changed_keys)
      QuantityChange.insert_all!(records) if records.any?
      stats(records)
    end

    private

    # CTEs: `totals` (per batch and key), `first_rows` (each key's first Excel row) and `lines` (both uploads side
    # by side; old_qty / new_qty NULL when the key is not in that upload).
    LINES = <<~SQL.freeze
      WITH totals AS (
        SELECT r.upload_batch_id AS batch_id, r.po_number, r.po_line_number, r.part_number, r.ship_date,
               SUM(COALESCE(r.effective_qty, 0)) AS qty
        FROM order_rows r WHERE r.upload_batch_id IN (:current, :previous)
        GROUP BY 1, 2, 3, 4, 5
      ), first_rows AS (
        SELECT DISTINCT ON (r.upload_batch_id, r.po_number, r.po_line_number, r.part_number, r.ship_date) r.*
        FROM order_rows r WHERE r.upload_batch_id IN (:current, :previous)
        ORDER BY r.upload_batch_id, r.po_number, r.po_line_number, r.part_number, r.ship_date, r.source_row_number
      ), lines AS (
        SELECT COALESCE(n.po_number, o.po_number) AS po_number, COALESCE(n.po_line_number, o.po_line_number) AS po_line_number,
               COALESCE(n.part_number, o.part_number) AS part_number, COALESCE(n.ship_date, o.ship_date) AS ship_date,
               o.qty AS old_qty, n.qty AS new_qty
        FROM (SELECT * FROM totals WHERE batch_id = :current) n
        FULL JOIN (SELECT * FROM totals WHERE batch_id = :previous) o
          ON o.po_number = n.po_number AND o.po_line_number = n.po_line_number AND o.part_number = n.part_number
         AND o.ship_date = n.ship_date
      )
    SQL

    def connection
      ActiveRecord::Base.connection
    end

    def sql(template)
      ActiveRecord::Base.sanitize_sql_array([ template, { current: @current, previous: @previous } ])
    end

    # Every key whose Qty differs, as quantity_changes attributes (before reschedule pairing).
    def changed_keys
      now = Time.current
      connection.select_all(sql(<<~SQL)).map do |l|
        #{LINES}
        SELECT l.*, nr.id AS order_row_id, orow.id AS previous_order_row_id,
               COALESCE(nr.ship_to_location, orow.ship_to_location) AS ship_to_location,
               COALESCE(nr.order_type, orow.order_type) AS order_type,
               COALESCE(nr.commodity_type, orow.commodity_type, p.commodity_type) AS commodity_type
        FROM lines l
        LEFT JOIN first_rows nr ON nr.upload_batch_id = :current AND nr.po_number = l.po_number
                               AND nr.po_line_number = l.po_line_number AND nr.part_number = l.part_number AND nr.ship_date = l.ship_date
        LEFT JOIN first_rows orow ON orow.upload_batch_id = :previous AND orow.po_number = l.po_number
                                 AND orow.po_line_number = l.po_line_number AND orow.part_number = l.part_number AND orow.ship_date = l.ship_date
        LEFT JOIN products p ON p.part_number = l.part_number
        WHERE COALESCE(l.new_qty, 0) <> COALESCE(l.old_qty, 0)
        ORDER BY l.po_number, l.po_line_number, l.part_number, l.ship_date
      SQL
        old_qty = l["old_qty"].to_d
        new_qty = l["new_qty"].to_d
        direction = if l["old_qty"].nil? then "added"
        elsif l["new_qty"].nil? then "removed"
        elsif new_qty > old_qty then "increase"
        else "decrease"
        end
        ship_date = l["ship_date"].to_date
        { upload_batch_id: @current, previous_upload_batch_id: @previous,
          order_row_id: l["order_row_id"], previous_order_row_id: l["previous_order_row_id"],
          business_key_hash: Digest::SHA256.hexdigest([ l["po_number"], l["po_line_number"], l["part_number"], ship_date.iso8601 ].join("|")),
          ship_to_location: l["ship_to_location"], order_type: l["order_type"], po_number: l["po_number"],
          po_line_number: l["po_line_number"], part_number: l["part_number"], ship_date: ship_date,
          previous_ship_date: nil, commodity_type: l["commodity_type"], old_qty: old_qty, new_qty: new_qty,
          difference: new_qty - old_qty, direction: direction, created_at: now }
      end
    end

    # Replaces each date that dropped to 0 and a date of the same PO line that rose from 0 by the same Qty with one
    # rescheduled change.
    def pair_reschedules(changes)
      changes.group_by { |c| c.values_at(:po_number, :po_line_number, :part_number) }.flat_map do |_, list|
        ins = list.select { |c| c[:old_qty].zero? && c[:new_qty].positive? }
        list.flat_map do |out|
          next [ out ] unless out[:new_qty].zero? && out[:old_qty].positive?

          match = ins.find { |c| c[:new_qty] == out[:old_qty] }
          next [ out ] unless match

          ins.delete(match)
          match[:rescheduled_from] = out
          []
        end.map do |c|
          out = c.delete(:rescheduled_from)
          next c unless out

          c.merge(previous_ship_date: out[:ship_date], previous_order_row_id: out[:previous_order_row_id],
                  old_qty: out[:old_qty], difference: 0, direction: "rescheduled")
        end
      end
    end

    # Keys compared (in both uploads) and unchanged come from the database; the change counts from the records.
    def stats(records)
      row = connection.select_one(sql(<<~SQL))
        #{LINES}
        SELECT COUNT(*) FILTER (WHERE old_qty IS NOT NULL AND new_qty IS NOT NULL) AS compared_count,
               COUNT(*) FILTER (WHERE new_qty = old_qty) AS unchanged_count
        FROM lines
      SQL
      counts = records.group_by { |r| r[:direction] }.transform_values(&:size)
      Stats.new(compared_count: row["compared_count"].to_i, unchanged_count: row["unchanged_count"].to_i,
                increase_count: counts.fetch("increase", 0), decrease_count: counts.fetch("decrease", 0),
                new_row_count: counts.fetch("added", 0), missing_row_count: counts.fetch("removed", 0),
                rescheduled_count: counts.fetch("rescheduled", 0))
    end
  end
end
