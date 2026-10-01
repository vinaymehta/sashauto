module ExcelImport
  # Turns raw workbook rows into exactly one normalized row per business key, or a list of
  # actionable errors. Nothing here touches the database.
  class OrderRowParser
    # rows: one per order key (duplicates merged). all_rows: every valid Excel row, unmerged, with its source data.
    Result = Data.define(:rows, :all_rows, :errors, :warnings, :source_row_count, :duplicate_rows_merged, :unknown_quantity_count) do
      def valid?
        errors.empty?
      end
    end

    REQUIRED_VALUES = {
      ship_to_location: "Ship To Location",
      order_type: "Type",
      po_number: "PO Number",
      po_line_number: "PO Line Number",
      part_number: "Part Number",
      ship_date: "Ship Date"
    }.freeze

    def initialize(reader)
      @reader = reader
    end

    def call
      errors = []
      candidates = []
      source_row_count = 0

      @reader.each_row do |raw|
        source_row_count += 1
        row, row_errors = normalize(raw)
        row_errors.empty? ? candidates << row : errors.concat(row_errors)
      end

      if source_row_count.zero?
        errors << { rows: [], column: nil, message: "The workbook has a header row but no data rows." }
      end

      rows, duplicate_errors, merged = resolve_duplicates(candidates)
      errors.concat(duplicate_errors)

      unknown = rows.count { |row| row[:quantity_source] == "unknown" }
      warnings = []
      if unknown.positive?
        warnings << { code: "unknown_quantity", count: unknown,
                      message: "#{unknown} row(s) have neither Qty nor Previous Qty. They are stored with an unknown quantity and are not compared." }
      end

      Result.new(rows: rows, all_rows: candidates, errors: errors, warnings: warnings, source_row_count: source_row_count,
                 duplicate_rows_merged: merged, unknown_quantity_count: unknown)
    end

    private

    def normalize(raw)
      values = raw[:values]
      number = raw[:row_number]
      errors = []
      n = OrderRows::Normalizer

      field = ->(name, label) { yield_or_error(errors, number, label) { n.public_send(normalizer_for(name), values[name]) } }

      row = {
        ship_to_location: field.(:ship_to_location, "Ship To Location"),
        order_type: field.(:order_type, "Type"),
        po_number: field.(:po_number, "PO Number"),
        po_line_number: field.(:po_line_number, "PO Line Number"),
        part_number: field.(:part_number, "Part Number"),
        ship_date: field.(:ship_date, "Ship Date"),
        commodity_type: n.text(values[:commodity_type]),
        qty: field.(:qty, "Qty"),
        previous_qty: field.(:previous_qty, "Previous Qty"),
        current_release_number: n.text(values[:current_release_number]),
        current_release_date: n.text(values[:current_release_date]),
        source_row_numbers: [ number ],
        source: raw[:source] || {}
      }.merge(details(values))

      REQUIRED_VALUES.each do |key, label|
        next unless row[key].nil?
        next if errors.any? { |e| e[:column] == label } # already reported as invalid
        errors << { rows: [ number ], column: label, message: "#{label} is missing." }
      end
      return [ nil, errors ] if errors.any?

      row[:effective_qty], row[:quantity_source] = n.effective_quantity(row[:qty], row[:previous_qty])
      row[:business_key_hash] = n.business_key_hash(**row.slice(*REQUIRED_VALUES.keys))
      [ row, [] ]
    end

    DETAIL_TYPES = {
      due_date: :date, last_asn_date: :date, last_receipt_date: :date, last_released_date: :date, last_updated_date: :date,
      last_asn_qty: :quantity, last_receipt_qty: :quantity,
      unit: :text, plant_code: :text, last_packing_list_number: :text, crossdock_location: :text,
      dock_number: :text, supplier_part_number: :text
    }.freeze

    # Display-only fields never reject an upload: an unreadable value is stored as blank.
    def details(values)
      DETAIL_TYPES.to_h do |field, type|
        value = begin
          OrderRows::Normalizer.public_send(type, values[field])
        rescue OrderRows::Normalizer::InvalidValue
          nil
        end
        [ field, value ]
      end
    end

    def normalizer_for(name)
      case name
      when :ship_to_location then :ship_to_location
      when :order_type then :order_type
      when :po_number, :po_line_number then :identifier
      when :part_number then :part_number
      when :ship_date then :date
      when :qty, :previous_qty then :quantity
      end
    end

    def yield_or_error(errors, row_number, label)
      yield
    rescue OrderRows::Normalizer::InvalidValue => e
      errors << { rows: [ row_number ], column: label, message: "#{label} #{e.message}." }
      nil
    end

    # Duplicate rule: prefer rows with Qty, then rows with Previous Qty. If several equally valid rows
    # remain they must agree on effective quantity and Commodity Type; otherwise it is a conflict.
    def resolve_duplicates(candidates)
      rows = []
      errors = []
      merged = 0

      candidates.group_by { |row| row[:business_key_hash] }.each_value do |group|
        if group.size == 1
          rows << group.first
          next
        end

        preferred = group.select { |row| row[:quantity_source] == "qty" }
        preferred = group.select { |row| row[:quantity_source] == "previous_qty" } if preferred.empty?
        preferred = group if preferred.empty?

        if preferred.map { |row| [ row[:effective_qty], row[:commodity_type] ] }.uniq.size > 1
          errors << duplicate_conflict(preferred)
          next
        end

        chosen = preferred.min_by { |row| row[:source_row_numbers].first }
        rows << chosen.merge(source_row_numbers: group.flat_map { |row| row[:source_row_numbers] }.sort)
        merged += group.size - 1
      end

      [ rows, errors, merged ]
    end

    def duplicate_conflict(rows)
      first = rows.first
      numbers = rows.map { |row| row[:source_row_numbers].first }.sort
      quantities = rows.map { |row| row[:effective_qty]&.to_s("F")&.delete_suffix(".0") || "blank" }.uniq
      commodities = rows.map { |row| row[:commodity_type] || "blank" }.uniq
      detail = []
      detail << "quantities #{quantities.join(' vs ')}" if quantities.size > 1
      detail << "commodity types #{commodities.join(' vs ')}" if commodities.size > 1
      {
        rows: numbers,
        column: nil,
        message: "Rows #{numbers.join(', ')} are the same order row (#{first[:order_type]}, PO #{first[:po_number]} " \
                 "line #{first[:po_line_number]}, part #{first[:part_number]}, ship date #{first[:ship_date].iso8601}, " \
                 "#{first[:ship_to_location]}) but have conflicting #{detail.join(' and ')}. Keep one row and upload again."
      }
    end
  end
end
