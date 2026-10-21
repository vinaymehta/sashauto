module Orders
  # The Firm Date of an order, kept by order key so later uploads keep it. Two sources:
  # - the file's own "Firm Date" column (import): the base file gives the Firm Date of its orders, and wins;
  # - otherwise the day the order first reached the part's MOQ (record), e.g. orders that are new after the base file.
  # A combined order (Orders::Combiner, kept under combined_key) gets the latest Firm Date of its rows; only when none of
  # them has one, the day it reached the MOQ. Kept even when the Qty drops again. Forecast orders never get a Firm Date.
  module FirmDates
    module_function

    HEADER = "firm date"

    # Stores the "Firm Date" column of an upload (when the file has one) for its Firm/Order rows, replacing a date
    # recorded by `record`. Rows with the same order key: the earliest date given. Blank cells are left alone.
    def import(batch_id)
      dates = {}
      OrderRow.where(upload_batch_id: batch_id).where.not(order_type: "Forecast")
              .select(:id, :group_key, :po_line_number, :ship_date, :source_data).each do |row|
        date = file_date(row.source_data)
        next if date.nil?

        key = VendorOrderPlacement.order_key(row)
        dates[key] = [ dates[key], date ].compact.min
      end
      return if dates.empty?

      now = Time.current
      OrderFirmDate.upsert_all(dates.map { |key, date| { order_key: key, firm_on: date, created_at: now, updated_at: now } },
                               unique_by: :order_key, update_only: :firm_on) # Rails sets updated_at when it changes
    end

    # Firm Dates of the orders of `result` at or above the MOQ. A combined order takes the latest Firm Date of its rows
    # (set again each time, so it follows rows added or taken out); any other order without a Firm Date yet gets today.
    # Only for the latest upload (or the one being imported): orders of earlier uploads were recorded while those were
    # current.
    def record(batch_id, result)
      latest = UploadBatch.latest_completed(UploadBatch.where(id: batch_id).pick(:business))&.id
      return if result.firm.empty? || (latest && batch_id < latest)

      now = Time.current
      from_rows = combined_from_rows(result)
      if from_rows.any?
        OrderFirmDate.upsert_all(from_rows.map { |key, date| { order_key: key, firm_on: date, created_at: now, updated_at: now } },
                                 unique_by: :order_key, update_only: :firm_on)
      end

      keys = result.firm.values.uniq - from_rows.keys
      missing = keys - OrderFirmDate.where(order_key: keys).pluck(:order_key)
      return if missing.empty?

      today = Time.find_zone!(AppConfig.ageing_time_zone).today
      OrderFirmDate.insert_all(missing.map { |key| { order_key: key, firm_on: today, created_at: now, updated_at: now } },
                               unique_by: :order_key)
    end

    # combined key => the latest Firm Date of its rows, for the combined orders of `result` at or above the MOQ whose
    # rows have one.
    def combined_from_rows(result)
      groups = result.groups.values.select { |g| g.combined? && result.firm.key?(g.anchor_id) }
      member_keys = groups.to_h { |g| [ g.anchor_id, g.members.map { |m| VendorOrderPlacement.order_key(m) } ] }
      dates = for_keys(member_keys.values.flatten.uniq)
      groups.filter_map do |g|
        latest = member_keys[g.anchor_id].filter_map { |key| dates[key] }.max
        [ result.firm[g.anchor_id], latest ] if latest
      end.to_h
    end

    # Key of a combined order's own Firm Date (the day it reached the MOQ), apart from the file's Firm Date of its first
    # order (stored under that order's key).
    def combined_key(anchor_key)
      Digest::SHA256.hexdigest([ "combined", anchor_key ].join(OrderRows::Normalizer::KEY_SEPARATOR))
    end

    # combined_key in SQL, from an order key expression.
    def combined_key_sql(key_sql)
      "encode(sha256(convert_to('combined' || chr(31) || (#{key_sql}), 'UTF8')), 'hex')"
    end

    # order key => Firm Date
    def for_keys(keys)
      OrderFirmDate.where(order_key: keys).pluck(:order_key, :firm_on).to_h
    end

    # row id => Firm Date, for rows of any table with PO Number, Part Number, Type, PO Line Number and Ship Date
    # (snapshot rows, quantity changes). Forecast rows have none.
    def for_rows(rows)
      keys = rows.reject { |row| row.order_type == "Forecast" }.to_h { |row| [ row.id, key_for(row) ] }
      dates = for_keys(keys.values.uniq)
      keys.transform_values { |key| dates[key] }.compact
    end

    # The order key (VendorOrderPlacement.order_key) from the row's own columns.
    def key_for(row)
      group_key = OrderRow.group_key(row.po_number, row.part_number, row.order_type)
      Digest::SHA256.hexdigest([ group_key, row.po_line_number, row.ship_date.iso8601 ].join(OrderRows::Normalizer::KEY_SEPARATOR))
    end

    # The same order key in SQL, from the columns of `table` (a quoted table name or alias).
    def key_sql(table)
      sep = "chr(31)"
      group_key = "encode(sha256(convert_to(concat_ws(#{sep}, #{table}.po_number, #{table}.part_number, #{table}.order_type), 'UTF8')), 'hex')"
      "encode(sha256(convert_to(concat_ws(#{sep}, #{group_key}, #{table}.po_line_number, " \
        "to_char(#{table}.ship_date, 'YYYY-MM-DD')), 'UTF8')), 'hex')"
    end

    # The row's "Firm Date" cell (any spacing / case of the header) as a date; nil when blank or unreadable.
    def file_date(source_data)
      _, value = source_data.find { |header, _| header.to_s.squish.casecmp?(HEADER) }
      value = value.first(10) if value.is_a?(String) && value.match?(/\A\d{4}-\d{2}-\d{2}T/) # a date-time cell
      OrderRows::Normalizer.date(value)
    rescue OrderRows::Normalizer::InvalidValue
      nil
    end
  end
end
