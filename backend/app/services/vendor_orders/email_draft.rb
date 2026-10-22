require "erb"

module VendorOrders
  # The email an admin sends a vendor with its purchase order (and, for a vendor at the 0.1% GST rate, the Intimation
  # Letter), in SASH's wording. The app never sends it: it is shown in the Order details (Email draft) to copy, with
  # its highlights (copied as formatted text, so they stay when pasted into an email).
  #
  #   EmailDraft.for_order(vendor_order)   # { to, subject, body, paragraphs, html }
  class EmailDraft
    # Days after which parts not supplied on time are shipped by Air at the vendor's cost.
    AIR_SHIPMENT_DAYS = 75
    # How a paragraph is marked, as in SASH's email: a green or yellow highlight (underlined), or bold underlined.
    STYLES = {
      "green" => "background-color:#66ff66;text-decoration:underline;",
      "yellow" => "background-color:#ffff66;text-decoration:underline;",
      "strong" => "font-weight:bold;text-decoration:underline;"
    }.freeze

    attr_reader :to, :subject, :paragraphs

    def self.for_order(order)
      new(vendor: order.vendor, number: order.number, sender: order.vendor_order_placement.placed_by&.name)
    end

    def initialize(vendor:, number:, sender:)
      @vendor = vendor
      @number = number
      @sender = sender
      @company = AppConfig.company
      @to = vendor.email.to_s.split(/\s*[,;]\s*/).map(&:strip).reject(&:empty?)
      @subject = "Purchase Order #{number} - #{@company[:name]}"
      @paragraphs = build_paragraphs
    end

    # Plain text (a blank line between paragraphs; the signature lines together).
    def body
      paragraphs.map { |p| p[:text] }.join("\n\n")
    end

    # The same email as HTML, with its highlights, for pasting into an email.
    def html
      paragraphs.map do |p|
        text = ERB::Util.html_escape(p[:text]).gsub("\n", "<br>")
        text = %(<span style="#{STYLES.fetch(p[:style])}">#{text}</span>) if p[:style]
        "<p style=\"margin:0 0 12px;\">#{text}</p>"
      end.join
    end

    def as_json(*)
      { to: to, subject: subject, body: body, paragraphs: paragraphs, html: html }
    end

    private

    def build_paragraphs
      [
        { text: "#{greeting}," },
        { text: "Please find PO #{@number} from SASH as attached." },
        { text: "The Labels for the parts on this PO shall be Plain. Only mentioning the SASH Parts numbers.", style: "green" },
        (if @vendor.intimation_letter?
           { text: "The GST intimation letter is also attached. Request you to submit the same in your Department and send us back " \
                   "the scanned copy of the Department receiving.", style: "yellow" }
         end),
        { text: "Kindly let us know via return email if you can send the parts on this PO by the mentioned date. If not, let us " \
                "know the next firm, best date, as we need to enter that date into our system." },
        { text: "At the same time, we would need to remind you that in case the correct parts are not supplied by you on time at " \
                "a max of #{AIR_SHIPMENT_DAYS} days, they will come under a category where they shall have to be shipped by Air at " \
                "your cost. It is at the discretion of the buyer whether to ask for supplying the entire lot or some quantity or " \
                "maybe even not asking for shipment by Air. But, if that happens, the cost would be debited to your account.",
          style: "strong" },
        { text: "Thus, better to have the parts supplied on time." },
        { text: "This implies for the parts in the current PO, or current open orders at your end and those parts' quantities " \
                "that would be issued in future to you." },
        { text: "Please confirm." },
        { text: [ "Regards,", @sender, @company[:name], [ @company[:phone], @company[:email] ].compact_blank.join(" | ").presence ]
                  .compact_blank.join("\n") }
      ].compact
    end

    # "Dear Gaurav ji" for an Indian vendor's contact (first name), "Dear Gaurav" abroad, else "Dear Sir/Madam".
    def greeting
      name = @vendor.first_name.presence || @vendor.contact_name
      return "Dear Sir/Madam" if name.blank?

      @vendor.gst_treatment == "overseas" ? "Dear #{name}" : "Dear #{name} ji"
    end
  end
end
