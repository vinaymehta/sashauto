require "zip"

module ExcelImport
  # Streams data rows from the first worksheet of a Supplier Requirements .xlsx export.
  # Yields { row_number:, values: { field => raw cell value } } for each non-blank data row.
  class WorkbookReader
    # Canonical field => header text in the export (matched case- and whitespace-insensitively).
    COLUMNS = {
      order_type: "Type",
      ship_date: "Ship Date",
      po_number: "PO Number",
      po_line_number: "PO Line Number",
      part_number: "Part Number",
      commodity_type: "Commodity Type",
      qty: "Qty",
      previous_qty: "Previous Qty",
      ship_to_location: "Ship To Location",
      current_release_date: "Current Release Date",
      current_release_number: "Current Release Number"
    }.freeze

    # Display-only columns (Orders page). Optional: a workbook without them is still accepted.
    DETAIL_COLUMNS = {
      due_date: "Due Date", unit: "Unit", plant_code: "Plant Code",
      last_asn_qty: "Last ASN Qty", last_asn_date: "Last ASN Date",
      last_receipt_qty: "Last Receipt Qty", last_receipt_date: "Last Receipt Date",
      last_packing_list_number: "Last Packing List Number", crossdock_location: "Crossdock Location",
      dock_number: "Dock Number", supplier_part_number: "Supplier Part Number",
      last_released_date: "Last Released Date", last_updated_date: "Last Updated Date"
    }.freeze

    HEADER_SEARCH_ROWS = 20
    MAX_DATA_ROWS = 200_000
    MAX_UNCOMPRESSED_BYTES = 250.megabytes # guards against zip bombs

    def initialize(path)
      @path = path.to_s
    end

    def each_row
      return enum_for(:each_row) unless block_given?

      check_archive!
      column_index = nil
      data_rows = 0

      workbook.each_row_streaming(pad_cells: true) do |cells|
        row_number = cells.compact.first&.coordinate&.row
        next if row_number.nil?
        raw = cells.map { |cell| cell&.value }

        if column_index.nil?
          column_index = header_index(raw)
          if column_index.nil? && row_number >= HEADER_SEARCH_ROWS
            raise_missing_header!
          end
          next
        end

        next if raw.all? { |value| OrderRows::Normalizer.text(value).nil? }

        data_rows += 1
        if data_rows > MAX_DATA_ROWS
          raise InvalidWorkbook.new("too_many_rows", "The workbook has more than #{MAX_DATA_ROWS} data rows.")
        end

        yield({ row_number: row_number, values: column_index.transform_values { |i| raw[i] } })
      end

      raise_missing_header! if column_index.nil?
    rescue Zip::Error, Nokogiri::XML::SyntaxError, ArgumentError, TypeError => e
      raise InvalidWorkbook.new("corrupt_workbook", "The file could not be read as an Excel workbook (#{e.class.name.demodulize}).")
    end

    private

    def workbook
      book = Roo::Excelx.new(@path, extension: :xlsx, file_warning: :ignore)
      raise InvalidWorkbook.new("no_worksheet", "The workbook contains no worksheets.") if book.sheets.empty?
      book.default_sheet = book.sheets.first
      book
    end

    def check_archive!
      Zip::File.open(@path) do |zip|
        unless zip.find_entry("xl/workbook.xml")
          raise InvalidWorkbook.new("not_xlsx", "The file is not an Excel .xlsx workbook.")
        end
        if zip.entries.sum(&:size) > MAX_UNCOMPRESSED_BYTES
          raise InvalidWorkbook.new("too_large", "The workbook is too large to process.")
        end
      end
    end

    # Returns { field => column index } when this row contains every expected header, else nil.
    def header_index(raw)
      labels = raw.map { |value| canonical(value) }
      found = COLUMNS.transform_values { |header| labels.index(canonical(header)) }
      return nil if found.values.compact.size < 3 # not a header row

      missing = COLUMNS.select { |field, _| found[field].nil? }.values
      if missing.any?
        raise InvalidWorkbook.new("missing_columns", "Required column(s) missing: #{missing.join(', ')}.")
      end

      duplicated = COLUMNS.values.select { |header| labels.count(canonical(header)) > 1 }
      if duplicated.any?
        raise InvalidWorkbook.new("duplicate_columns", "Column(s) appear more than once: #{duplicated.join(', ')}.")
      end

      found.merge(DETAIL_COLUMNS.transform_values { |header| labels.index(canonical(header)) }.compact)
    end

    def canonical(value)
      OrderRows::Normalizer.text(value)&.downcase
    end

    def raise_missing_header!
      raise InvalidWorkbook.new("header_not_found",
        "Could not find the header row. Expected columns: #{COLUMNS.values.join(', ')}.")
    end
  end
end
