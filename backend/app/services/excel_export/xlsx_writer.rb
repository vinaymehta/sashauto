require "zip"

module ExcelExport
  # Minimal .xlsx writer: one sheet, a bold header row, then the rows (numbers as numbers, everything else as text).
  # Built with rubyzip (already installed for reading workbooks with roo), so no extra dependency is needed.
  module XlsxWriter
    module_function

    # Returns the workbook as a binary String.
    def call(headers, rows, sheet_name: "Sheet1")
      buffer = Zip::OutputStream.write_buffer do |zip|
        files(headers, rows, sheet_name).each do |path, xml|
          zip.put_next_entry(path)
          zip.write(xml)
        end
      end
      buffer.string
    end

    def files(headers, rows, sheet_name)
      {
        "[Content_Types].xml" => <<~XML,
          <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
          <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
            <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
            <Default Extension="xml" ContentType="application/xml"/>
            <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
            <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
          </Types>
        XML
        "_rels/.rels" => <<~XML,
          <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
          </Relationships>
        XML
        "xl/workbook.xml" => <<~XML,
          <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
          <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <sheets><sheet name="#{escape(sheet_name.to_s.first(31))}" sheetId="1" r:id="rId1"/></sheets>
          </workbook>
        XML
        "xl/_rels/workbook.xml.rels" => <<~XML,
          <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
            <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
          </Relationships>
        XML
        "xl/styles.xml" => <<~XML,
          <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
          <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
            <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
            <borders count="1"><border/></borders>
            <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
            <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
          </styleSheet>
        XML
        "xl/worksheets/sheet1.xml" => sheet(headers, rows)
      }
    end

    def sheet(headers, rows)
      lines = [ row_xml(1, headers, style: 1) ] + rows.each_with_index.map { |values, i| row_xml(i + 2, values) }
      <<~XML
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
          <sheetData>#{lines.join}</sheetData>
        </worksheet>
      XML
    end

    def row_xml(number, values, style: nil)
      cells = values.each_with_index.map do |value, i|
        ref = "#{column(i)}#{number}"
        s = style ? %( s="#{style}") : ""
        if value.is_a?(Numeric)
          %(<c r="#{ref}"#{s}><v>#{value.is_a?(BigDecimal) ? value.to_s("F") : value}</v></c>)
        elsif value.nil? || value.to_s.empty?
          ""
        else
          %(<c r="#{ref}"#{s} t="inlineStr"><is><t xml:space="preserve">#{escape(value.to_s)}</t></is></c>)
        end
      end
      %(<row r="#{number}">#{cells.join}</row>)
    end

    # 0 → A, 25 → Z, 26 → AA
    def column(index)
      name = +""
      index += 1
      while index.positive?
        index, rest = (index - 1).divmod(26)
        name.prepend((65 + rest).chr)
      end
      name
    end

    # XML-escaped, without the control characters XML does not allow.
    def escape(text)
      text.gsub(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, "").encode(xml: :text).gsub('"', "&quot;")
    end
  end
end
