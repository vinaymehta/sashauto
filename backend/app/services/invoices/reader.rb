require "bigdecimal"

module Invoices
  # Reads a SASH invoice (the export invoice template, as .pdf or .xlsx): who issued it (kind "india": Sash Autotech Pvt.
  # Ltd.; "inc": SASH Autotech, Inc.), the Invoice No. & Date, and its item lines (PO, Part, Qty).
  #
  # Both formats become the same rows of cells ([column, value], left to right), parsed by labels and patterns, not
  # fixed positions:
  #   * PDF (pdf-reader): each text line of the invoice pages, cut into cells where 2+ spaces separate text (the column
  #     is the character position). Pages of the packing list are left out.
  #   * Excel: each row of the first sheet with "Invoice No.", every non-blank cell (the column is the cell's), up to
  #     the packing list.
  # Then:
  #   * Exporter: the first text below the "Exporter" label (fallback: the consignee, Lotus Automotive or John Deere).
  #   * Invoice number and date: below the "Invoice No. & Date" label, from its column on: the first invoice-number-like
  #     text, then the first date after it ("29.10.2026", "Date: Nov 3rd, 2026", an Excel date).
  #   * A cell with "PO No.5500910948 dt.02.02.2026" starts a PO group; its item rows follow.
  #   * Item row: a Part No. cell (PART, e.g. JXAW30717) and its Quantity, the last number with a unit ("192 Nos.", or
  #     192 then "Nos."), else the number under the "Quantity" header.
  #   * The lines' Qty is checked against the invoice's total ("… 3803  Total USD"), when the file has one.
  # Only the PDF template is verified (both sample invoices); the Excel reading follows the same template and the
  # patterns below are the place to adjust when a real .xlsx differs.
  #
  #   Invoices::Reader.call(path:, filename:)   # => Result
  class Reader
    class InvalidFile < StandardError; end

    Line = Data.define(:index, :po_number, :po_date, :part_number, :description, :qty)
    Result = Data.define(:kind, :exporter, :invoice_number, :invoice_date, :lines, :warnings)

    EXPORTER_LABEL = /\AExporter\b/i
    INVOICE_LABEL = /\AInvoice\s*No\b/i
    QUANTITY_LABEL = /\AQuantity\z/i
    PO_GROUP = /PO\s*No\.?\s*:?\s*(\d{6,})(?:\s*dt\.?\s*:?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}))?/i
    PART = /\A[A-Z]{1,6}\d[A-Z0-9]{2,}\z/
    UNIT = /\A(?:nos|pcs|sets?|ea|units?)\.?\z/i
    NUMBER = /\A\d{1,3}(?:,\d{3})*(?:\.\d+)?\z|\A\d+(?:\.\d+)?\z/
    NUMBER_WITH_UNIT = /\A(\d[\d,]*(?:\.\d+)?)\s*(?:nos|pcs|sets?|ea|units?)\.?\z/i
    INVOICE_NUMBER = /\A[A-Z0-9][A-Z0-9\/.\-]*\d[A-Z0-9\/.\-]*\z/i
    TOTAL = /([\d,]+(?:\.\d+)?)\s+Total\s+(?:USD|US\s*\$|INR|Amount)/i
    # A cell this many characters (PDF) or columns (Excel) left of a label still counts as below it.
    PDF_TOLERANCE = 4
    MAX_LINES = 500

    def self.call(path:, filename:)
      new(path, filename).call
    end

    def initialize(path, filename)
      @path = path.to_s
      @extension = File.extname(filename.to_s).downcase
    end

    def call
      @rows = case @extension
      when ".pdf" then pdf_rows
      when ".xlsx" then excel_rows
      else raise InvalidFile, "Choose a .pdf or .xlsx invoice."
      end
      raise InvalidFile, "No text could be read from the file (a scanned PDF cannot be read)." if @rows.all?(&:empty?)

      exporter = exporter_name
      kind = kind_of(exporter)
      raise InvalidFile, "Could not tell who issued the invoice: no \"Sash Autotech Pvt. Ltd.\" or \"SASH Autotech, Inc.\" as Exporter." unless kind

      number, date = invoice_number_and_date
      raise InvalidFile, "Could not find the invoice number below \"Invoice No. & Date\"." unless number
      raise InvalidFile, "Could not find the invoice date next to invoice #{number}." unless date

      lines = item_lines
      raise InvalidFile, "No item lines (Part No. with a Quantity) were found in invoice #{number}." if lines.empty?

      Result.new(kind: kind, exporter: exporter, invoice_number: number, invoice_date: date, lines: lines, warnings: total_warnings(lines))
    end

    private

    # Text lines of the invoice pages as cells: [[character position, text], ...] per line.
    def pdf_rows
      reader = PDF::Reader.new(@path)
      reader.pages.flat_map do |page|
        text = page.text
        next [] if packing_list?(text)

        text.lines.map { |line| line.to_enum(:scan, /\S+(?: \S+)*/).map { [ Regexp.last_match.begin(0), Regexp.last_match[0] ] } }
      end
    rescue PDF::Reader::MalformedPDFError, PDF::Reader::UnsupportedFeatureError, PDF::Reader::EncryptedPDFError => e
      raise InvalidFile, "The file could not be read as a PDF (#{e.class.name.demodulize})."
    end

    # A packing list page (its title before any invoice title).
    def packing_list?(text)
      first = text.lines.map(&:strip).find(&:present?).to_s
      first.match?(/PACKING\s+LIST/i) && !first.match?(/INVOICE/i)
    end

    # Rows of the invoice sheet as cells: [[column index, value], ...] (values as Roo gives them: text, numbers, dates).
    def excel_rows
      book = Roo::Excelx.new(@path, extension: :xlsx, file_warning: :ignore)
      sheets = book.sheets.map { |name| book.sheet(name) }
      sheet = sheets.find { |s| s.first_row && (s.first_row..[ s.last_row, s.first_row + 40 ].min).any? { |n| s.row(n).any? { |c| INVOICE_LABEL.match?(cell_text(c)) } } }
      raise InvalidFile, "No sheet of the workbook has \"Invoice No. & Date\"." unless sheet

      rows = []
      (sheet.first_row..sheet.last_row).each do |n|
        cells = sheet.row(n).each_with_index.filter_map { |value, col| [ col, value ] unless cell_text(value).nil? }
        break if rows.any? && cells.any? { |_, value| cell_text(value).match?(/\APACKING\s+LIST\z/i) }

        rows << cells
      end
      rows
    rescue Zip::Error, ArgumentError, Roo::Error => e
      raise InvalidFile, "The file could not be read as an .xlsx workbook (#{e.class.name.demodulize})."
    end

    def tolerance
      @extension == ".pdf" ? PDF_TOLERANCE : 0
    end

    def cell_text(value)
      case value
      when Date, Time, DateTime then value.to_date.strftime("%d.%m.%Y")
      else OrderRows::Normalizer.text(value).to_s
      end
    end

    # [row index, column] of the first cell matching `pattern`.
    def find_label(pattern)
      @rows.each_with_index do |cells, i|
        cells.each { |col, value| return [ i, col ] if pattern.match?(cell_text(value)) }
      end
      nil
    end

    # The next `count` rows with cells after row `index`.
    def rows_below(index, count)
      @rows[(index + 1)..].to_a.reject(&:empty?).first(count)
    end

    def exporter_name
      at = find_label(EXPORTER_LABEL)
      return nil unless at

      row = rows_below(at[0], 1).first.to_a
      cell_text(row.min_by(&:first)&.last).presence
    end

    def kind_of(exporter)
      return "india" if exporter.to_s.match?(/sash\s+autotech\s+(pvt|private)/i)
      return "inc" if exporter.to_s.match?(/sash\s+autotech,?\s+inc\b/i)

      # Fallback: the consignee (SASH India ships to Lotus Automotive, SASH Inc to John Deere).
      text = @rows.flat_map { |cells| cells.map { |_, value| cell_text(value) } }.join("\n")
      return "india" if text.match?(/lotus\s+automotive/i) && !text.match?(/john\s+deere/i)
      return "inc" if text.match?(/john\s+deere/i) && !text.match?(/lotus\s+automotive/i)

      nil
    end

    # [invoice number, invoice date] below the "Invoice No. & Date" label, from its column on.
    def invoice_number_and_date
      at = find_label(INVOICE_LABEL)
      return [ nil, nil ] unless at

      rows_below(at[0], 3).each do |cells|
        cells = cells.select { |col, _| col >= at[1] - tolerance }
        cells.each_with_index do |(_, value), i|
          number = cell_text(value).split(/\s+/).first.to_s
          next unless number.match?(INVOICE_NUMBER) && number.length <= 64 && !date(number)

          rest = [ cell_text(value).delete_prefix(number) ] + cells[(i + 1)..].map(&:last)
          return [ number.upcase, rest.lazy.filter_map { |v| date(v) }.first ]
        end
      end
      [ nil, nil ]
    end

    # The item lines, each under the PO group above it.
    def item_lines
      quantity_at = find_label(QUANTITY_LABEL)
      po = nil
      lines = []
      @rows.each do |cells|
        texts = cells.map { |_, value| cell_text(value) }
        if (group = texts.lazy.filter_map { |t| PO_GROUP.match(t) }.first)
          po = { number: group[1], date: group[2] && date(group[2]) }
        end
        part_at = texts.index { |t| PART.match?(t.upcase) && !t.match?(PO_GROUP) }
        next unless part_at

        qty = quantity(cells, part_at, quantity_at&.last)
        next unless qty

        description = texts[part_at + 1]
        lines << Line.new(index: lines.size, po_number: po&.dig(:number), po_date: po&.dig(:date), part_number: texts[part_at].upcase,
                          description: description&.match?(/[a-z]/i) ? description.first(200) : nil, qty: qty)
        raise InvalidFile, "The invoice has more than #{MAX_LINES} item lines." if lines.size > MAX_LINES
      end
      lines
    end

    # Quantity of an item row: the last number with a unit after the Part No. ("192 Nos.", or 192 then "Nos."), else the
    # number in the "Quantity" column.
    def quantity(cells, part_at, quantity_col)
      after = cells[(part_at + 1)..]
      found = nil
      after.each_with_index do |(_, value), i|
        text = cell_text(value)
        if (m = NUMBER_WITH_UNIT.match(text))
          found = m[1]
        elsif UNIT.match?(text) && i.positive? && number?(after[i - 1].last)
          found = after[i - 1].last
        end
      end
      if found.nil? && quantity_col
        found = after.select { |col, value| number?(value) && (col - quantity_col).abs <= tolerance }.min_by { |col, _| (col - quantity_col).abs }&.last
      end
      number = found && (OrderRows::Normalizer.quantity(found.is_a?(String) ? found.delete(",") : found) rescue nil)
      number&.positive? ? number : nil
    end

    def number?(value)
      value.is_a?(Numeric) || NUMBER.match?(cell_text(value))
    end

    # A warning when the lines' Qty does not add up to the invoice's total Qty (the number before "Total USD").
    def total_warnings(lines)
      text = @rows.map { |cells| cells.map { |_, value| cell_text(value) }.join("  ") }.reverse.find { |t| TOTAL.match?(t) }
      return [] unless text

      total = (OrderRows::Normalizer.quantity(TOTAL.match(text)[1].delete(",")) rescue nil)
      sum = lines.sum(&:qty)
      return [] if total.nil? || total == sum

      [ "The item lines add up to Qty #{Serializers.qty(sum)}, but the invoice total is #{Serializers.qty(total)}: check that every line was read." ]
    end

    # A date from an Excel date or text: 29.10.2026 (day first, as the invoices), "Date: Nov 3rd, 2026", 3 Nov 2026,
    # 2026-11-03.
    def date(value)
      return value.to_date if value.is_a?(Date) || value.is_a?(Time)

      text = cell_text(value).sub(/\A(?:date|dt)\.?\s*:?\s*/i, "")
      if (m = text.match(/\A(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/))
        Date.new(m[3].to_i, m[2].to_i, m[1].to_i)
      elsif (m = text.match(/\A([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/))
        Date.parse("#{m[2]} #{m[1]} #{m[3]}")
      elsif (m = text.match(/\A(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?[\s,-]+(\d{4})\b/))
        Date.parse("#{m[1]} #{m[2]} #{m[3]}")
      elsif text.match?(/\A\d{4}-\d{2}-\d{2}\b/)
        Date.iso8601(text.first(10))
      end
    rescue Date::Error
      nil
    end
  end
end
