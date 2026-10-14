require "prawn"

module VendorOrders
  # PDF purchase order for one vendor order: SASH (from .env, see AppConfig.company) buys from the vendor. Layout:
  # company header with "PURCHASE ORDER", order number and date; Supplier / Delivery Address / Invoice Address boxes
  # (SASH Faridabad delivers and is invoiced); currency and required-by date; the item line with unit cost and total;
  # notes. `draft` prints DRAFT (preview before placing).
  class PdfBuilder
    Line = Data.define(:our_article, :vendor_article, :description, :qty, :uom, :unit_cost, :total, :note)
    Po = Data.define(:number, :date, :vendor, :required_by, :currency, :prepared_by, :lines, :draft)

    # The SASH logo, as in the email header.
    LOGO = Rails.root.join("app/assets/images/sash-logo-email.png")
    NAVY = "1d2636"
    ACCENT = "b42318"
    GREY = "6b7280"
    LINE = "c9ced6"
    HEADER_FILL = "e5e7eb"

    # The saved PDF of a placed vendor order.
    def self.for_order(order)
      placement = order.vendor_order_placement
      link = order.vendor.vendor_products.find_by(product_id: placement.product_id)
      new(po(number: order.number, date: order.created_at.to_date, vendor: order.vendor, required_by: order.ship_date || placement.ship_date,
             currency: order.price_currency, prepared_by: placement.placed_by&.name,
             product: placement.product, link: link, qty: order.qty, unit: order.unit, unit_price: order.unit_price,
             note: order.price_note, draft: false)).render
    end

    # A preview (not saved) of the vendor order that placing would create.
    def self.preview(vendor:, product:, link:, qty:, unit:, unit_price:, required_by:, prepared_by:)
      new(po(number: "DRAFT", date: Date.current, vendor: vendor, required_by: required_by, currency: link&.price_currency || "INR",
             prepared_by: prepared_by, product: product, link: link, qty: qty, unit: unit, unit_price: unit_price,
             note: link&.price_note, draft: true)).render
    end

    def self.po(number:, date:, vendor:, required_by:, currency:, prepared_by:, product:, link:, qty:, unit:, unit_price:, note:, draft:)
      pack = [ link&.pack_size || product&.pack_size || 1, 1 ].max
      uom = unit == "pcs" || pack <= 1 ? "PCS" : "SET of #{pack}"
      line = Line.new(our_article: link&.sash_part || product&.sash_part, vendor_article: link&.vendor_part || product&.vendor_part,
                      description: link&.description || product&.description, qty: qty, uom: uom, unit_cost: unit_price,
                      total: unit_price && unit_price * qty, note: note)
      Po.new(number: number, date: date, vendor: vendor, required_by: required_by, currency: currency, prepared_by: prepared_by,
             lines: [ line ], draft: draft)
    end

    def initialize(po)
      @po = po
      @company = AppConfig.company
    end

    def render
      pdf = Prawn::Document.new(page_size: "A4", margin: [ 36, 36, 40, 36 ], info: { Title: "Purchase Order #{@po.number}", Creator: @company[:name] })
      pdf.font("Helvetica")
      pdf.font_size(9)
      header(pdf)
      parties(pdf)
      banner(pdf)
      info_row(pdf)
      items(pdf)
      totals(pdf)
      footer(pdf)
      watermark(pdf) if @po.draft
      pdf.render
    end

    private

    # Helvetica (built in) only has the Windows-1252 characters; anything else becomes "?".
    def t(value)
      value.to_s.encode("Windows-1252", invalid: :replace, undef: :replace, replace: "?").encode("UTF-8")
    end

    def lines_of(text)
      text.to_s.gsub("\\n", "\n").split("\n").map(&:strip).reject(&:empty?)
    end

    def money(value, decimals: 2)
      return "" if value.nil?
      whole, frac = format("%.#{decimals}f", value.to_d.round(decimals)).split(".")
      "#{whole.reverse.scan(/\d{1,3}/).join(',').reverse}.#{frac}"
    end

    def unit_cost(value)
      return "" if value.nil?
      value.to_d.round(4) == value.to_d.round(2) ? money(value) : money(value, decimals: 4)
    end

    def qty(value)
      number = value.to_d
      number.frac.zero? ? number.to_i.to_s : number.to_s("F")
    end

    def header(pdf)
      top = pdf.cursor
      pdf.bounding_box([ 0, top ], width: 300) do
        pdf.image LOGO.to_s, height: 28 if LOGO.exist?
        pdf.move_down 8
        pdf.fill_color NAVY
        pdf.text t(@company[:name]), size: 14, style: :bold
        pdf.fill_color "333333"
        pdf.move_down 4
        lines_of(@company[:address]).each { |l| pdf.text t(l) }
        [ ("GSTIN: #{@company[:gst]}" if @company[:gst].present?), ("T #{@company[:phone]}" if @company[:phone].present?),
          ("E #{@company[:email]}" if @company[:email].present?) ].compact.each { |l| pdf.text t(l) }
      end
      bottom = pdf.cursor
      pdf.bounding_box([ 330, top ], width: 193) do
        pdf.fill_color ACCENT
        pdf.text "PURCHASE ORDER", size: 18, align: :right
        pdf.fill_color "000000"
        pdf.move_down 10
        pdf.formatted_text [ { text: "Order No:  ", styles: [ :bold ], size: 11 }, { text: t(@po.number), styles: [ :bold ], size: 11 } ], align: :right
        pdf.move_down 2
        pdf.text "Order Date:  #{@po.date.strftime('%d %b %Y').upcase}", align: :right
        pdf.move_down 2
        pdf.text "Page 1 of 1", align: :right, color: GREY
      end
      pdf.move_cursor_to [ bottom, pdf.cursor ].min
      pdf.move_down 12
    end

    def parties(pdf)
      vendor = @po.vendor
      supplier = [ vendor.name, *lines_of(vendor.address) ]
      supplier << "Tel: #{vendor.phone}" if vendor.phone.present?
      supplier << vendor.email if vendor.email.present?
      supplier << "GSTIN: #{vendor.gst}" if vendor.gst.present?
      sash = [ @company[:name], *lines_of(@company[:address]) ]
      boxes = [ [ "Supplier:", supplier ], [ "Delivery Address:", sash ], [ "Invoice Address:", sash ] ]
      width = (pdf.bounds.width - 16) / 3.0
      height = 118
      top = pdf.cursor
      boxes.each_with_index do |(title, rows), i|
        x = i * (width + 8)
        pdf.stroke_color LINE
        pdf.stroke_rounded_rectangle([ x, top ], width, height, 6)
        pdf.bounding_box([ x + 8, top - 8 ], width: width - 16, height: height - 14) do
          pdf.text title, style: :bold
          pdf.move_down 4
          rows.each { |row| pdf.text t(row), overflow: :shrink_to_fit }
        end
      end
      pdf.move_cursor_to top - height - 12
    end

    def banner(pdf)
      pdf.fill_color ACCENT
      pdf.text "*** PLEASE CONFIRM PRICES BY EMAIL BEFORE DESPATCHING GOODS ***", align: :center, style: :bold, size: 10
      pdf.fill_color "000000"
      pdf.move_down 10
    end

    # A row of label/value cells: Currency · Required By · Prepared By.
    def info_row(pdf)
      cells = [ [ "Currency", @po.currency ], [ "Required By", @po.required_by&.strftime("%d %b %Y")&.upcase ], [ "Prepared By", @po.prepared_by ] ]
      width = pdf.bounds.width / cells.size
      top = pdf.cursor
      cells.each_with_index do |(label, value), i|
        x = i * width
        pdf.fill_color HEADER_FILL
        pdf.fill_rectangle([ x, top ], width, 16)
        pdf.fill_color "000000"
        pdf.stroke_color LINE
        pdf.stroke_rectangle([ x, top ], width, 32)
        pdf.stroke_line([ x, top - 16 ], [ x + width, top - 16 ])
        pdf.text_box label, at: [ x, top - 4 ], width: width, align: :center
        pdf.text_box t(value.presence || "-"), at: [ x, top - 20 ], width: width, align: :center
      end
      pdf.move_cursor_to top - 32 - 10
    end

    COLUMNS = [
      [ "Our Article No", 78, :left ], [ "Your Article No", 78, :left ], [ "Item Description", 0, :left ],
      [ "Qty", 40, :right ], [ "UOM", 52, :center ], [ "Unit Cost", 62, :right ], [ "Line Total", 70, :right ]
    ].freeze

    def column_widths(pdf)
      fixed = COLUMNS.sum { |_, w, _| w }
      COLUMNS.map { |_, w, _| w.zero? ? pdf.bounds.width - fixed : w }
    end

    def items(pdf)
      widths = column_widths(pdf)
      top = pdf.cursor
      x = 0
      COLUMNS.each_with_index do |(label, _, align), i|
        pdf.fill_color HEADER_FILL
        pdf.fill_rectangle([ x, top ], widths[i], 18)
        pdf.fill_color "000000"
        pdf.text_box label, at: [ x + 4, top - 5 ], width: widths[i] - 8, align: align, style: :bold
        x += widths[i]
      end
      row_top = top - 18
      body_height = 230
      @po.lines.each do |line|
        values = [ line.our_article, line.vendor_article, line.description, qty(line.qty), line.uom, unit_cost(line.unit_cost), money(line.total) ]
        x = 0
        values.each_with_index do |value, i|
          pdf.text_box t(value), at: [ x + 4, row_top - 5 ], width: widths[i] - 8, height: 40, align: COLUMNS[i][2], overflow: :shrink_to_fit
          x += widths[i]
        end
        pdf.text_box t(line.note), at: [ widths[0] + widths[1] + 4, row_top - 20 ], width: widths[2] - 8, height: 30, style: :italic,
                                   color: GREY, overflow: :shrink_to_fit if line.note.present?
        row_top -= 44
      end
      # Column grid down to the totals, like a printed order form.
      pdf.stroke_color LINE
      pdf.stroke_rectangle([ 0, top ], pdf.bounds.width, 18 + body_height)
      x = 0
      widths[0..-2].each do |w|
        x += w
        pdf.stroke_line([ x, top ], [ x, top - 18 - body_height ])
      end
      pdf.move_cursor_to top - 18 - body_height
    end

    def totals(pdf)
      total = @po.lines.sum { |l| l.total || 0 }
      widths = column_widths(pdf)
      label_x = widths[0..2].sum
      label_w = widths[3] + widths[4] + widths[5]
      top = pdf.cursor
      rows = [ [ "Total", money(total) ], [ "Total (#{@po.currency})", money(total) ] ]
      rows.each_with_index do |(label, value), i|
        y = top - (i * 18)
        pdf.fill_color i == rows.size - 1 ? HEADER_FILL : "ffffff"
        pdf.fill_rectangle([ label_x, y ], label_w + widths[6], 18)
        pdf.fill_color "000000"
        pdf.stroke_color LINE
        pdf.stroke_rectangle([ label_x, y ], label_w, 18)
        pdf.stroke_rectangle([ label_x + label_w, y ], widths[6], 18)
        pdf.text_box label, at: [ label_x + 4, y - 5 ], width: label_w - 8, style: :bold
        pdf.text_box value, at: [ label_x + label_w + 4, y - 5 ], width: widths[6] - 8, align: :right, style: :bold
      end
      pdf.text_box "Delivery Instructions:", at: [ 0, top - 2 ], width: label_x - 10, style: :bold
      pdf.text_box t("Deliver to #{@company[:name]} by #{@po.required_by&.strftime('%d %b %Y') || 'the required date'}."),
                   at: [ 0, top - 14 ], width: label_x - 10
      pdf.move_cursor_to top - (rows.size * 18) - 14
    end

    # Supply instructions and the terms the order is issued under (SASH's own wording; the terms address comes from
    # COMPANY_TERMS_URL in .env when set), in a box below a separator line.
    def footer(pdf)
      name = @company[:name]
      pdf.move_down 2
      pdf.text "Please include the PO number on your invoice.", align: :right, style: :bold
      pdf.move_down 10
      pdf.stroke_color LINE
      pdf.stroke_horizontal_rule
      pdf.move_down 8

      body = { size: 7.5, leading: 1.5, align: :justify, color: "374151" }
      pdf.fill_color "111827"
      pdf.text "PLEASE SUPPLY THE ABOVE GOODS AND QUOTE THIS PURCHASE ORDER NUMBER WITH YOUR DELIVERY AND INVOICE. " \
               "DELIVERIES WITHOUT THIS NUMBER MAY BE REFUSED.", style: :bold, size: 8, leading: 1.5
      pdf.move_down 6
      pdf.text t("Subject to #{name}'s Terms and Conditions of Purchase"), style: :bold, size: 8.5
      pdf.move_down 3
      pdf.text "This order is issued under, and governed by:", **body
      pdf.move_down 2
      [
        [ "(a)", "the terms of any written supply agreement in force between #{name} and the Supplier for the goods or services on this order; or" ],
        [ "(b)", "where there is no such agreement, #{name}'s Terms and Conditions of Purchase in effect on the date of this order, together " \
                 "with any special conditions or attachments referred to in this order." ]
      ].each do |label, text|
        top = pdf.cursor
        pdf.text_box label, at: [ 8, top ], width: 18, size: 7.5, color: "374151"
        pdf.bounding_box([ 26, top ], width: pdf.bounds.width - 26) { pdf.text t(text), **body }
        pdf.move_down 2
      end
      pdf.move_down 3
      paragraphs = [
        (@company[:terms_url].present? ? "The Terms and Conditions of Purchase are available at #{@company[:terms_url]}." : nil),
        "By supplying the goods or services on this order, the Supplier accepts the terms that apply to it.",
        "Terms printed on the Supplier's quotation, invoice, delivery note or other documents do not apply unless #{name} agrees " \
        "to them in writing."
      ].compact
      paragraphs.each do |text|
        pdf.text t(text), **body
        pdf.move_down 2
      end
      pdf.fill_color "000000"
    end

    def watermark(pdf)
      pdf.transparent(0.12) do
        pdf.fill_color ACCENT
        pdf.rotate(30, origin: [ pdf.bounds.width / 2, pdf.bounds.height / 2 ]) do
          pdf.draw_text "DRAFT", at: [ pdf.bounds.width / 2 - 150, pdf.bounds.height / 2 - 30 ], size: 110, style: :bold
        end
      end
      pdf.fill_color "000000"
    end
  end
end
