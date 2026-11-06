module Comparison
  # Two versions (uploads) of one business compared, for the Orders page's Comparison tab; nothing is stored. Each
  # order line (PO Number + PO Line Number + Part Number + Ship Date) that differs: its Qty change as on each upload
  # (QuantityComparator: up, down, added, removed, or moved to another date), and changes of Type, Due Date or Ship To
  # Location of a line in both versions ("changed" when its Qty is the same).
  class VersionDiff
    FIELDS = { "order_type" => "Type", "due_date" => "Due Date", "ship_to_location" => "Ship To" }.freeze

    def self.call(from_batch_id:, to_batch_id:)
      new(Integer(from_batch_id), Integer(to_batch_id)).call
    end

    def initialize(from_id, to_id)
      @from = from_id
      @to = to_id
    end

    # [{ po_number, po_line_number, part_number, order_type, ship_date, previous_ship_date, old_qty, new_qty,
    #    difference, direction, order_row_id, previous_order_row_id, fields: [{ label, old, new }] }], by Ship Date.
    def call
      lines = QuantityComparator.new(@to, @from).changes.map { |c| c.slice(*KEEP).merge(fields: []) }
      by_key = lines.index_by { |l| l.values_at(:po_number, :po_line_number, :part_number, :ship_date) }
      field_changes.each do |key, change|
        line = by_key[key] ||= (lines << change.merge(direction: "changed", difference: 0)).last
        line[:fields] = change[:fields]
      end
      lines.sort_by { |l| [ l[:ship_date], l[:po_number].to_s, l[:po_line_number].to_s, l[:part_number].to_s ] }
    end

    KEEP = %i[po_number po_line_number part_number order_type ship_date previous_ship_date old_qty new_qty difference direction
              order_row_id previous_order_row_id].freeze

    private

    # Lines in both versions whose first row's Type, Due Date or Ship To Location differs.
    def field_changes
      sql = ActiveRecord::Base.sanitize_sql_array([ <<~SQL, { from: @from, to: @to } ])
        WITH first_rows AS (
          SELECT DISTINCT ON (r.upload_batch_id, r.po_number, r.po_line_number, r.part_number, r.ship_date) r.*
          FROM order_rows r WHERE r.upload_batch_id IN (:from, :to)
          ORDER BY r.upload_batch_id, r.po_number, r.po_line_number, r.part_number, r.ship_date, r.source_row_number
        )
        SELECT n.po_number, n.po_line_number, n.part_number, n.ship_date, n.id AS order_row_id, o.id AS previous_order_row_id,
               o.effective_qty AS old_qty, n.effective_qty AS new_qty,
               o.order_type AS old_order_type, n.order_type AS new_order_type, o.due_date AS old_due_date, n.due_date AS new_due_date,
               o.ship_to_location AS old_ship_to_location, n.ship_to_location AS new_ship_to_location
        FROM first_rows n
        JOIN first_rows o ON o.upload_batch_id = :from AND o.po_number = n.po_number AND o.po_line_number = n.po_line_number
                         AND o.part_number = n.part_number AND o.ship_date = n.ship_date
        WHERE n.upload_batch_id = :to
          AND (o.order_type IS DISTINCT FROM n.order_type OR o.due_date IS DISTINCT FROM n.due_date
               OR o.ship_to_location IS DISTINCT FROM n.ship_to_location)
      SQL
      ActiveRecord::Base.connection.select_all(sql).to_h do |r|
        fields = FIELDS.filter_map do |column, label|
          old, new = r["old_#{column}"], r["new_#{column}"]
          { label: label, old: old, new: new } if old.to_s != new.to_s
        end
        key = [ r["po_number"], r["po_line_number"], r["part_number"], r["ship_date"].to_date ]
        [ key, { po_number: r["po_number"], po_line_number: r["po_line_number"], part_number: r["part_number"], order_type: r["new_order_type"],
                 ship_date: r["ship_date"].to_date, previous_ship_date: nil, old_qty: r["old_qty"].to_d, new_qty: r["new_qty"].to_d,
                 order_row_id: r["order_row_id"], previous_order_row_id: r["previous_order_row_id"], fields: fields } ]
      end
    end
  end
end
