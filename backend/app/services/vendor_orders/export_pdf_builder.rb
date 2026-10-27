module VendorOrders
  # Purchase order for an overseas vendor (China, UK, Europe…), in SASH's export layout: one bordered form with
  # Invoice To / Despatch To / Supplier, the order number, date and the customer's PO as Other Reference, "Dispatch to be
  # done before" the Vendor Ship Due Date, the item with SASH's Part No. and the vendor's, the supply requirements, the
  # total in the vendor's currency and in words, and SASH's notices. No GST (goods for export). Shares PdfBuilder's
  # order data and helpers.
  class ExportPdfBuilder < PdfBuilder
    SYMBOLS = { "USD" => "$", "GBP" => "£", "EUR" => "€", "CNY" => "¥", "INR" => "Rs." }.freeze
    # Amount in words: [currency, minor unit] ("USD Five Hundred Seventy Two and Cents Fifty Only").
    WORDS = { "USD" => %w[USD Cents], "GBP" => %w[GBP Pence], "EUR" => %w[EUR Cents], "CNY" => %w[CNY Fen], "INR" => %w[INR Paise] }.freeze
    BLACK = "000000"
    SHADE = "ddd9c4"

    def render
      pdf = Prawn::Document.new(page_size: "A4", margin: [ 30, 30, 30, 30 ], info: { Title: "Purchase Order #{@po.number}", Creator: @company[:name] })
      pdf.font("Helvetica")
      pdf.font_size(8)
      pdf.stroke_color BLACK
      pdf.line_width 0.6
      @w = pdf.bounds.width
      title(pdf)
      head(pdf)
      items(pdf)
      amount_in_words(pdf)
      signature_row(pdf)
      notices(pdf)
      watermark(pdf) if @po.draft
      pdf.render
    end

    private

    def title(pdf)
      top = pdf.cursor
      pdf.stroke_rectangle([ 0, top ], @w, 22)
      pdf.text_box "PURCHASE ORDER", at: [ 0, top - 4 ], width: @w, align: :center, size: 15, style: :bold
      pdf.move_cursor_to top - 22
    end

    # Left: Invoice To, Despatch To, Supplier. Right: order no / date, references, delivery date, terms.
    def head(pdf)
      top = pdf.cursor
      left = 290
      mid = (@w - left) / 2.0
      company = @company[:name]
      cell(pdf, 0, top, left, 52, "Invoice To", [ [ company, :bold ], "GSTIN/UIN : #{@company[:gst]}", "CIN: #{@company[:cin]}" ])
      cell(pdf, 0, top - 52, left, 74, "Despatch To", [ [ company, :bold ], *lines_of(@company[:address]), "e-mail : #{@company[:email]}" ])
      vendor = @po.vendor
      cell(pdf, 0, top - 126, left, 74, "Supplier", [ [ vendor.name, :bold ], *lines_of(vendor.address), "GSTIN/UIN : #{vendor.gst}" ])

      cell(pdf, left, top, mid, 26, "Order No", [ [ @po.number, :bold ] ])
      cell(pdf, left + mid, top, mid, 26, "Dated", [ [ @po.date.strftime("%d-%b-%y"), :bold ] ])
      cell(pdf, left, top - 26, mid, 26, "Supplier's Ref./Order No.", [])
      cell(pdf, left + mid, top - 26, mid, 26, "Other Reference(s)", [ [ @po.reference.to_s, :bold ] ])
      delivery(pdf, left, top - 52, mid, 74)
      cell(pdf, left + mid, top - 52, mid, 30, "Destination", [])
      cell(pdf, left + mid, top - 82, mid, 44, "Mode/Terms of Payment", [])
      pdf.text_box t(payment_terms), at: [ left + mid + 3, top - 96 ], width: mid - 6, height: 26, align: :center, style: :bold,
                                     size: 8.5, overflow: :shrink_to_fit
      cell(pdf, left, top - 126, @w - left, 54, "Terms of Delivery", [])
      pdf.text_box t(terms_of_delivery), at: [ left + 3, top - 140 ], width: @w - left - 6, height: 36, align: :center, valign: :center,
                                         style: :bold, size: 9, overflow: :shrink_to_fit
      pdf.stroke_rectangle([ left, top - 180 ], @w - left, 20)
      pdf.text_box "All Items are for Export", at: [ left, top - 186 ], width: @w - left, align: :center
      pdf.move_cursor_to top - 200
    end

    # The Mode/Terms of Payment box: the vendor's payment terms.
    def payment_terms = @po.vendor.payment_terms.to_s

    # The Terms of Delivery box (empty on the export PO).
    def terms_of_delivery = ""

    # Before the Rate and Amount ("$ 12.50"); blank on the Indian PO.
    def currency_symbol = "#{SYMBOLS.fetch(@po.currency.to_s, "#{@po.currency} ")} "

    # A bordered cell: a small label, then its lines (a line is text, or [text, :bold]).
    def cell(pdf, x, y, width, height, label, rows)
      pdf.stroke_rectangle([ x, y ], width, height)
      pdf.bounding_box([ x + 3, y - 2 ], width: width - 6, height: height - 3) do
        pdf.text label, size: 7, color: "333333"
        rows.each do |text, style|
          pdf.text t(text), style: style || :normal, size: 8, overflow: :shrink_to_fit
        end
      end
    end

    # "Dispatch to be done before" the Vendor Ship Due Date, shaded as in SASH's form.
    def delivery(pdf, x, y, width, height)
      pdf.fill_color SHADE
      pdf.fill_rectangle([ x, y ], width, height)
      pdf.fill_color BLACK
      pdf.stroke_rectangle([ x, y ], width, height)
      pdf.text_box "Delivery Date", at: [ x + 3, y - 2 ], width: width - 6, size: 7, style: :bold
      pdf.formatted_text_box([ { text: "Dispatch to be done before", styles: %i[bold underline] }, { text: "\n\n" },
                               { text: @po.required_by&.strftime("%B %-d, %Y").to_s, styles: %i[bold underline] } ],
                             at: [ x, y - 22 ], width: width, align: :center, size: 9)
    end

    COLUMNS = [ [ "Sl\nNo.", 22, :center ], [ "Description of Good's", 0, :left ], [ "Part No.", 72, :center ], [ "Vendor\nPart No.", 72, :center ],
                [ "Quantity", 56, :center ], [ "Rate", 58, :right ], [ "per", 28, :center ], [ "Amount", 70, :right ] ].freeze

    def widths
      fixed = COLUMNS.sum { |_, w, _| w }
      COLUMNS.map { |_, w, _| w.zero? ? @w - fixed : w }
    end

    # The item, the Requirements list and the Total row, in a ruled table.
    def items(pdf)
      w = widths
      top = pdf.cursor
      head_h = 22
      body_h = 330
      xs = w.each_with_index.map { |_, i| w[0...i].sum }
      COLUMNS.each_with_index do |(label, _, _), i|
        pdf.text_box label, at: [ xs[i] + 2, top - 3 ], width: w[i] - 4, height: head_h - 4, style: :bold, align: i == 1 ? :left : :center
      end
      sym = currency_symbol
      row_top = top - head_h - 3
      @po.lines.each_with_index do |line, n|
        per = line.uom.to_s.start_with?("PCS") ? "Nos." : "Sets"
        values = [ (n + 1).to_s, line.description, line.part_number, line.vendor_article,
                   qty(line.qty), line.unit_cost ? "#{sym}#{unit_cost(line.unit_cost)}" : "", per, line.total ? "#{sym}#{money(line.total)}" : "" ]
        values.each_with_index do |value, i|
          pdf.text_box t(value), at: [ xs[i] + 3, row_top ], width: w[i] - 6, height: 34, align: COLUMNS[i][2] == :left ? :left : (i >= 5 ? :right : :center),
                                 overflow: :shrink_to_fit
        end
        row_top -= 36
      end
      # The Requirements sit at the bottom of the body, just above the Total row; the column lines stop around them.
      req_top = top - head_h - body_h + requirements_height(pdf, w) + 6
      requirements(pdf, xs, w, req_top)

      # Grid: header and body, column lines, then the Total row.
      pdf.stroke_rectangle([ 0, top ], @w, head_h + body_h + 18)
      pdf.stroke_horizontal_line(0, @w, at: top - head_h)
      pdf.stroke_horizontal_line(0, @w, at: top - head_h - body_h)
      pdf.stroke_vertical_line(top, top - head_h - body_h - 18, at: xs[1])
      xs[2..].each do |x|
        pdf.stroke_vertical_line(top, req_top + 4, at: x)
        pdf.stroke_vertical_line(top - head_h - body_h, top - head_h - body_h - 18, at: x)
      end
      total = @po.lines.sum { |l| l.total || 0 }
      total_y = top - head_h - body_h
      pdf.text_box "Total", at: [ xs[1] + 3, total_y - 5 ], width: w[1] - 6
      pdf.text_box qty(@po.lines.sum { |l| l.qty.to_d }), at: [ xs[4] + 3, total_y - 5 ], width: w[4] - 6, align: :center, style: :bold
      pdf.text_box "#{sym}#{money(total)}", at: [ xs[7] + 3, total_y - 4 ], width: w[7] - 6, align: :right, style: :bold, size: 10
      pdf.move_cursor_to total_y - 18
      @total = total
    end

    # The width the Requirements are written in, and the height they take.
    def requirements_width(w) = w[1..].sum - 8

    def requirements_height(pdf, w)
      text_w = requirements_width(w)
      18 + requirement_blocks.sum { |block| pdf.height_of_formatted(RichText.fragments(pdf, block, size: 8, t: method(:t)), width: text_w - 8) + 5 }
    end

    # "Requirements :-" and SASH's supply rules (Admin Settings → Purchase Order; highlighted text on a black bar),
    # numbered in the Sl No. column, across the item columns.
    def requirements(pdf, xs, w, y)
      text_w = requirements_width(w)
      pdf.text_box "Requirements :-", at: [ xs[1] + 4, y ], width: text_w, size: 10, style: :bold
      y -= 18
      requirement_blocks.each_with_index do |block, i|
        fragments = RichText.fragments(pdf, block, size: 8, t: method(:t))
        height = pdf.height_of_formatted(fragments, width: text_w - 8) + 2
        pdf.formatted_text_box fragments, at: [ xs[1] + 4, y ], width: text_w - 8, height: height + 2
        pdf.text_box (i + 1).to_s, at: [ xs[0] + 2, y ], width: w[0] - 4, align: :right, size: 8
        y -= height + 3
      end
    end

    def amount_in_words(pdf)
      top = pdf.cursor
      pdf.stroke_rectangle([ 0, top ], @w, 44)
      pdf.text_box "Amount Chargeable (in words)", at: [ 3, top - 3 ], width: 200, size: 7
      pdf.text_box "E. & O.E", at: [ @w - 60, top - 3 ], width: 57, align: :right, size: 7, style: :italic
      pdf.text_box t(words_for(@total)), at: [ 0, top - 20 ], width: @w, align: :center, style: :bold
      pdf.move_cursor_to top - 44
    end

    # PAN, the first notice (Admin Settings → Purchase Order; e.g. lead / asbestos free) and the signatory box.
    def signature_row(pdf)
      top = pdf.cursor
      height = 56
      pdf.stroke_rectangle([ 0, top ], @w, height)
      pdf.text_box t("Company's PAN : #{@company[:pan]}"), at: [ 3, top - 26 ], width: 150
      notice(pdf, notice_blocks.first, x: 150, y: top - 14, width: 230, height: 38) if notice_blocks.any?
      pdf.stroke_rectangle([ @w - 140, top - 4 ], 140, height - 4)
      pdf.text_box t("for #{@company[:name]}"), at: [ @w - 138, top - 7 ], width: 136, align: :center, style: :bold, size: 7.5
      signature(pdf, @w - 140, top - 16)
      pdf.text_box "Authorised Signatory", at: [ @w - 138, top - 46 ], width: 134, align: :right, size: 7.5
      pdf.move_cursor_to top - height
    end

    # The signature over "Authorised Signatory" (none on the export PO).
    def signature(pdf, x, y); end

    # The other notices across the page (e.g. pallets / skids), then "This is a Computer Generated Document".
    def notices(pdf)
      top = pdf.cursor
      notice_blocks.drop(1).each do |block|
        height = [ pdf.height_of_formatted(notice_fragments(pdf, block), width: @w - 12) + 8, 18 ].max
        notice(pdf, block, x: 0, y: top, width: @w, height: height)
        top -= height
      end
      pdf.stroke_rectangle([ 0, top ], @w, 14)
      pdf.text_box "This is a Computer Generated Document", at: [ 0, top - 3 ], width: @w, align: :center, size: 7
    end

    # A notice in its box: a highlighted one white on black filling the box, others as they are, centred.
    def notice(pdf, block, x:, y:, width:, height:)
      if block.highlighted?
        pdf.fill_color BLACK
        pdf.fill_rectangle([ x, y ], width, height)
      end
      fragments = notice_fragments(pdf, block)
      pdf.formatted_text_box fragments, at: [ x + 6, y - 2 ], width: width - 12, height: height - 4, align: :center, valign: :center,
                                        overflow: :shrink_to_fit
      pdf.fill_color BLACK
    end

    # A notice's text: on a black box the whole text is white (the box is the bar).
    def notice_fragments(pdf, block)
      RichText.fragments(pdf, block, size: 8.5, t: method(:t)).map do |fragment|
        block.highlighted? ? fragment.except(:callback).merge(color: "FFFFFF") : fragment
      end
    end

    # The Requirements and the notices (Admin Settings → Purchase Order, the overseas PO's), with {company} filled in.
    def requirement_blocks
      @requirement_blocks ||= RichText.blocks(requirements_text, list: true, company: @company[:name], terms_url: @company[:terms_url])
    end

    def notice_blocks
      @notice_blocks ||= RichText.blocks(notices_text, company: @company[:name], terms_url: @company[:terms_url])
    end

    def requirements_text = AppConfig.export_po_requirements

    def notices_text = AppConfig.export_po_notices

    # "USD Five Hundred Seventy Two and Cents Fifty Only".
    def words_for(amount)
      currency, minor = WORDS.fetch(@po.currency.to_s, [ @po.currency.to_s, "Cents" ])
      value = amount.to_d.round(2)
      whole = value.to_i
      cents = ((value - whole) * 100).round.to_i
      text = "#{currency} #{number_words(whole)}"
      text += " and #{minor} #{number_words(cents)}" if cents.positive?
      "#{text} Only"
    end

    ONES = %w[Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen
              Eighteen Nineteen].freeze
    TENS = %w[_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety].freeze
    SCALES = [ [ 1_000_000_000, "Billion" ], [ 1_000_000, "Million" ], [ 1000, "Thousand" ] ].freeze

    def number_words(number)
      return ONES[number] if number < 20
      return [ TENS[number / 10], (ONES[number % 10] unless (number % 10).zero?) ].compact.join(" ") if number < 100
      return [ "#{ONES[number / 100]} Hundred", (number_words(number % 100) unless (number % 100).zero?) ].compact.join(" ") if number < 1000

      scale, name = SCALES.find { |s, _| number >= s }
      [ "#{number_words(number / scale)} #{name}", (number_words(number % scale) unless (number % scale).zero?) ].compact.join(" ")
    end
  end
end
