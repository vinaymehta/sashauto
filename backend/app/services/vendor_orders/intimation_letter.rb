require "prawn"

module VendorOrders
  # Intimation Letter sent with a vendor PO: tells the vendor (copy to its jurisdictional tax officer) that the goods
  # are bought for export at the concessional GST rate of 0.1% (Notification No. 40/2017-Central Tax (Rate)). Layout of
  # SASH's template: the SASH logo and company name, To, Copy to, subject, reference, PO No / Date, declaration, signature.
  #
  #   IntimationLetter.for_order(vendor_order)   # the saved letter's PDF
  #   IntimationLetter.preview(vendor:)          # DRAFT, before the PO is generated
  class IntimationLetter
    LOGO = Rails.root.join("app/assets/images/sash-logo-email.png") # the same SASH logo as on the purchase order
    SIGNATURE = Rails.root.join("app/assets/images/intimation-signature.png")
    Letter = Data.define(:vendor, :po_number, :po_date, :draft)

    def self.for_order(order)
      new(Letter.new(vendor: order.vendor, po_number: order.number, po_date: order.created_at.to_date, draft: false)).render
    end

    def self.preview(vendor:)
      new(Letter.new(vendor: vendor, po_number: "DRAFT", po_date: Date.current, draft: true)).render
    end

    # The export promotion council registration (RCMC), the export period and who signs, from Settings, else .env
    # (INTIMATION_*, COMPANY_REGISTERED_OFFICE). Not set: left blank in the letter.
    def self.settings
      env = ->(name) { AppConfig.setting(name).to_s.strip }
      {
        council: env.("INTIMATION_RCMC_COUNCIL"),
        rcmc_no: env.("INTIMATION_RCMC_NO"),
        rcmc_date: env.("INTIMATION_RCMC_DATE"),
        export_days: env.("INTIMATION_EXPORT_DAYS"),
        signatory_name: env.("INTIMATION_SIGNATORY_NAME"),
        signatory_title: env.("INTIMATION_SIGNATORY_TITLE"),
        registered_office: env.("COMPANY_REGISTERED_OFFICE")
      }
    end

    def initialize(letter)
      @letter = letter
      @company = AppConfig.company
      @config = self.class.settings
    end

    def render
      pdf = Prawn::Document.new(page_size: "A4", margin: [ 40, 50, 40, 50 ],
                                info: { Title: "Intimation Letter #{@letter.po_number}", Creator: @company[:name] })
      pdf.font "Helvetica", size: 10
      header(pdf)
      addresses(pdf)
      subject(pdf)
      body(pdf)
      signature(pdf)
      footer(pdf)
      watermark(pdf) if @letter.draft
      pdf.render
    end

    private

    def header(pdf)
      top = pdf.cursor
      pdf.image LOGO.to_s, at: [ 0, top ], height: 30 if LOGO.exist?
      pdf.text t(@company[:name]), size: 14, style: :bold, align: :center
      pdf.move_down 10
      pdf.text "Intimation Letter", size: 12, style: :bold, align: :center
      pdf.move_down 14
    end

    def addresses(pdf)
      vendor = @letter.vendor
      pdf.text "To,"
      pdf.text t(vendor.company_name.presence || vendor.name), style: :bold
      lines_of(vendor.address).each { |line| pdf.text t(line) }
      pdf.move_down 10
      pdf.text "Copy to:", style: :bold
      pdf.text "The Jurisdictional Tax Officer,"
      officer = lines_of(vendor.tax_officer_address)
      officer = [ "(address not on file)" ] if officer.empty?
      officer.each { |line| pdf.text t(line) }
      pdf.move_down 12
    end

    def subject(pdf)
      pdf.text "<b>Subject:</b> Intimation for procurement of goods at a concessional GST rate of 0.1% (0.05% CGST + 0.05% SGST / " \
               "0.1% IGST) for export purposes.", inline_format: true
      pdf.move_down 4
      pdf.text "<b>Reference:</b> Notification No. 40/2017-Central Tax (Rate) dated 23rd October 2017 / Notification No. " \
               "41/2017-Integrated Tax (Rate).", inline_format: true
      pdf.move_down 4
      pdf.text "<b>PO No:</b> #{esc(@letter.po_number)}", inline_format: true
      pdf.text "<b>PO Date:</b> #{date(@letter.po_date)}", inline_format: true
      pdf.move_down 12
    end

    def body(pdf)
      name = esc(@company[:name])
      address = esc(lines_of(@company[:address]).join(", "))
      days = esc(@config[:export_days].presence || "____")
      para = { inline_format: true, align: :justify, leading: 2 }
      pdf.text "Dear Sir/Madam,"
      pdf.move_down 8
      pdf.text "We, <b><u>#{name}</u></b>, having our principal place of business at <b><u>#{address}</u></b>, and holding valid " \
               "<b><u>GSTIN #{esc(@company[:gst])}</u></b>, are registered with <b><u>#{esc(@config[:council])}</u></b> under " \
               "Registration-cum-Membership Certificate (RCMC) No. <b><u>#{esc(@config[:rcmc_no])}</u></b> dated " \
               "<b>#{esc(@config[:rcmc_date])}</b>.", **para
      pdf.move_down 6
      pdf.text "We propose to purchase taxable goods from you vide our Purchase Order No. <b>#{esc(@letter.po_number)}</b> dated " \
               "<b>#{date(@letter.po_date)}</b> for the purpose of export out of India.", **para
      pdf.move_down 6
      pdf.text "We hereby intimate and declare that:"
      pdf.move_down 4
      [
        "Both the supplier and the recipient are registered under GST.",
        "The goods procured under your tax invoice will be exported out of India within <b>#{days} days</b> from the date of issue of " \
        "the supplier's tax invoice.",
        "We shall cross-reference your GSTIN and respective tax invoice numbers in our export invoices and shipping bills/bills of export.",
        "We shall furnish a copy of the shipping bill/bill of export containing details of your tax invoice along with proof of export " \
        "(EGM/Export Report) to you and the tax authorities.",
        "In case of failure to export the goods within #{days} days of the invoice date, we undertake to pay the full applicable GST " \
        "along with applicable interest."
      ].each_with_index do |item, i|
        top = pdf.cursor
        pdf.text_box "#{i + 1}.", at: [ 6, top ], width: 16
        pdf.bounding_box([ 22, top ], width: pdf.bounds.width - 22) { pdf.text item, **para }
        pdf.move_down 3
      end
      pdf.move_down 6
      pdf.text "Kindly issue the tax invoice at the concessional rate of 0.1% pursuant to the above-mentioned notifications.", **para
      pdf.move_down 10
    end

    def signature(pdf)
      pdf.text "Thanking you,"
      pdf.text "Yours faithfully,"
      pdf.text t("For #{@company[:name]}"), style: :bold
      pdf.move_down 4
      pdf.image SIGNATURE.to_s, height: 60 if SIGNATURE.exist? && !@letter.draft
      pdf.move_down(@letter.draft ? 60 : 4)
      pdf.text t(@config[:signatory_name]), style: :bold if @config[:signatory_name].present?
      pdf.text t(@config[:signatory_title]) if @config[:signatory_title].present?
    end

    # Company address, phone / email and registered office, centred at the bottom of the page.
    def footer(pdf)
      lines = [
        lines_of(@company[:address]).join(", ").presence,
        [ ("Tel: #{@company[:phone]}" if @company[:phone].present?), ("E Mail: #{@company[:email]}" if @company[:email].present?) ].compact.join(", ").presence,
        ("Regd. Off.: #{@config[:registered_office]}" if @config[:registered_office].present?)
      ].compact
      return if lines.empty?

      pdf.bounding_box([ 0, 14 + (lines.size * 10) ], width: pdf.bounds.width) do
        pdf.stroke_color "d1d5db"
        pdf.stroke_horizontal_rule
        pdf.move_down 4
        lines.each { |line| pdf.text t(line), size: 8, align: :center, color: "4b5563" }
      end
    end

    def watermark(pdf)
      pdf.transparent(0.12) do
        pdf.fill_color "b42318"
        pdf.rotate(30, origin: [ pdf.bounds.width / 2, pdf.bounds.height / 2 ]) do
          pdf.draw_text "DRAFT", at: [ pdf.bounds.width / 2 - 150, pdf.bounds.height / 2 - 30 ], size: 110, style: :bold
        end
      end
      pdf.fill_color "000000"
    end

    def date(value)
      value.strftime("%d/%m/%Y")
    end

    # Helvetica (built in) only has the Windows-1252 characters; anything else becomes "?".
    def t(value)
      value.to_s.encode("Windows-1252", invalid: :replace, undef: :replace, replace: "?").encode("UTF-8")
    end

    # For text inside inline-formatted strings (<b>, <u>).
    def esc(value)
      t(value).gsub("&", "&amp;").gsub("<", "&lt;").gsub(">", "&gt;")
    end

    def lines_of(text)
      text.to_s.gsub("\\n", "\n").split("\n").map(&:strip).reject(&:empty?)
    end
  end
end
