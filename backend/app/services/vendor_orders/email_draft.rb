module VendorOrders
  # The email an admin sends a vendor with its purchase order and Intimation Letter. The app never sends it: it is shown
  # in the Order details (Email draft) to copy.
  #
  #   EmailDraft.for_order(vendor_order)   # { to, subject, body }
  class EmailDraft
    attr_reader :to, :subject, :body

    def self.for_order(order)
      placement = order.vendor_order_placement
      link = order.vendor.vendor_products.find_by(product_id: placement.product_id)
      new(vendor: order.vendor, product: placement.product, link: link, number: order.number, date: order.created_at.to_date,
          qty: order.qty, unit: order.unit, unit_price: order.unit_price, currency: order.price_currency,
          required_by: order.ship_date || placement.ship_date, sender: placement.placed_by&.name)
    end

    def initialize(vendor:, product:, link:, number:, date:, qty:, unit:, unit_price:, currency:, required_by:, sender:)
      @vendor = vendor
      @product = product
      @link = link
      @number = number
      @date = date
      @qty = qty
      @unit = unit
      @unit_price = unit_price
      @currency = currency.presence || "INR"
      @required_by = required_by
      @sender = sender
      @company = AppConfig.company
      @to = vendor.email.to_s.split(/\s*[,;]\s*/).map(&:strip).reject(&:empty?)
      @subject = "Purchase Order #{number} - #{@company[:name]}"
      @body = build_body
    end

    def as_json(*)
      { to: to, subject: subject, body: body }
    end

    private

    def build_body
      contact = [ @vendor.salutation, @vendor.first_name, @vendor.last_name ].compact_blank.join(" ")
      items = [
        [ "Part Number", part_number ],
        [ "Description", @link&.description.presence || @product&.description ],
        [ "Quantity", "#{qty_text(@qty)} #{uom}" ],
        [ "Unit Price", (@unit_price && "#{@currency} #{price_text(@unit_price)} per #{per}") ],
        [ "Required By", @required_by&.strftime("%-d %b %Y") ]
      ].select { |_, value| value.present? }
      width = items.map { |label, _| label.size }.max
      signature = [ @sender, @company[:name],
                    [ @company[:phone], @company[:email] ].compact_blank.join(" | ").presence ].compact_blank

      <<~TEXT
        Dear #{contact.presence || 'Sir/Madam'},

        Please find attached our Purchase Order No. #{@number} dated #{@date.strftime('%-d %b %Y')}, together with the Intimation Letter for supply at the concessional GST rate of 0.1% (goods for export).

        #{items.map { |label, value| "#{"#{label}:".ljust(width + 1)}  #{value}" }.join("\n")}

        Kindly acknowledge this order and confirm the dispatch date.

        Thanks & Regards,
        #{signature.join("\n")}
      TEXT
    end

    # SASH's part number, then the vendor's own when it has one.
    def part_number
      ours = @link&.sash_part.presence || @product&.sash_part.presence || @product&.part_number
      theirs = @link&.vendor_part.presence || @product&.vendor_part.presence
      theirs && theirs != ours ? "#{ours} (your part no. #{theirs})" : ours
    end

    def pack
      [ @link&.pack_size || @product&.pack_size || 1, 1 ].max
    end

    def uom
      @unit == "pcs" || pack <= 1 ? "pcs" : "sets of #{pack} pcs"
    end

    def per
      @unit == "pcs" || pack <= 1 ? "pc" : "set"
    end

    def qty_text(value)
      number = value.to_d
      number == number.round ? number.to_i.to_s : number.to_s("F")
    end

    def price_text(value)
      decimals = value.to_d.round(4) == value.to_d.round(2) ? 2 : 4
      whole, frac = format("%.#{decimals}f", value.to_d.round(decimals)).split(".")
      "#{whole.reverse.scan(/\d{1,3}/).join(',').reverse}.#{frac}"
    end
  end
end
