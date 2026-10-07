module ExcelImport
  # Turns raw workbook rows into normalized rows (identical Excel rows counted once), or a list of
  # actionable errors. Nothing here touches the database.
  class OrderRowParser
    # rows: every valid Excel row, identical rows (all columns equal) merged into one. all_rows: every valid
    # Excel row, unmerged, with its source data.
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

      rows, merged = merge_identical(candidates)

      unknown = rows.count { |row| row[:quantity_source] == "unknown" }
      warnings = []
      if unknown.positive?
        warnings << { code: "unknown_quantity", count: unknown,
                      message: "#{unknown} row(s) have neither Qty nor Previous Qty. They are stored with an unknown quantity and are not compared." }
      end

      Result.new(rows: rows, all_rows: candidates, errors: errors, warnings: warnings, source_row_count: source_row_count,
                 duplicate_rows_merged: merged, unknown_quantity_count: unknown)
    end

    # Validates and normalizes one row with the same rules as an uploaded Excel row (used for manual orders).
    # Returns [row, errors].
    def parse_row(raw)
      normalize(raw)
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

    # Rows equal in every column (text compared without surrounding/repeated spaces; the export writes " " for
    # empty cells) are one row listed twice: they are merged and counted once. Rows that differ in any column,
    # even when they share the business key (e.g. one with Qty, one with only Previous Qty), are kept apart.
    # Returns [rows, number of rows merged away].
    def merge_identical(candidates)
      groups = candidates.group_by do |row|
        row[:source].values.map { |value| value.is_a?(String) ? OrderRows::Normalizer.text(value) : value }
      end
      rows = groups.each_value.map do |group|
        group.first.merge(source_row_numbers: group.flat_map { |row| row[:source_row_numbers] }.sort)
      end
      [ rows, candidates.size - rows.size ]
    end
  end
end
