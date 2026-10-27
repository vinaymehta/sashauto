module VendorOrders
  # Purchase order for an Indian vendor in SASH's own form (the default PO format, Admin Settings → Purchase Order):
  # the export layout (ExportPdfBuilder) with the Terms of Delivery ("Supplies to be made by charging as per GST rule")
  # and the payment terms from Admin Settings (the vendor's own payment terms first), its own Requirements and notices,
  # amounts in rupees without a symbol and in words the Indian way ("Rupees One Lakh Only"), and SASH's signature over
  # "Authorised Signatory".
  class IndiaPdfBuilder < ExportPdfBuilder
    SIGNATURE = Rails.root.join("app/assets/images/sash-signature.png")

    private

    def payment_terms = @po.vendor.payment_terms.presence || AppConfig.po_payment_terms

    def terms_of_delivery = AppConfig.po_delivery_terms

    # Its own Requirements and notices (Admin Settings → Purchase Order, India PO), apart from the overseas PO's.
    def requirements_text = AppConfig.india_po_requirements

    def notices_text = AppConfig.india_po_notices

    def currency_symbol = ""

    def signature(pdf, x, y)
      pdf.image SIGNATURE.to_s, at: [ x + 40, y + 2 ], height: 30 if SIGNATURE.exist?
    end

    INDIAN_SCALES = [ [ 10_000_000, "Crore" ], [ 100_000, "Lakh" ], [ 1000, "Thousand" ] ].freeze

    # "Rupees One Lakh Only", "Rupees Five Hundred Fifty and Paise Fifty Only".
    def words_for(amount)
      value = amount.to_d.round(2)
      rupees = value.to_i
      paise = ((value - rupees) * 100).round.to_i
      text = "Rupees #{indian_words(rupees)}"
      text += " and Paise #{indian_words(paise)}" if paise.positive?
      "#{text} Only"
    end

    def indian_words(number)
      return number_words(number) if number < 1000

      scale, name = INDIAN_SCALES.find { |s, _| number >= s }
      [ "#{indian_words(number / scale)} #{name}", (indian_words(number % scale) unless (number % scale).zero?) ].compact.join(" ")
    end
  end
end
