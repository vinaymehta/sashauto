# One Vendor Order sent to its vendor (when an admin emails it): that vendor's order with its unit price and line
# total, and the purchase order PDF attached. When the vendor has no email address it goes to the default recipients instead
# (`fallback`), with a note to forward it to the vendor.
class VendorOrderMailer < ApplicationMailer
  def placed
    @order = params.fetch(:vendor_order)
    @placement = @order.vendor_order_placement
    @product = @placement.product
    @fallback = params.fetch(:fallback, false)
    # Pieces per set, for the quantity line ("200 sets of 10 pcs (2,000 pcs)" / "500 pcs").
    @pack = @order.vendor.vendor_products.find_by(product_id: @placement.product_id)&.pack_size || @product&.pack_size || 1
    if @order.unit_price
      per = @order.unit == "pcs" || @pack <= 1 ? "pc" : "set"
      @unit_price = "#{@order.price_currency} #{format_amount(@order.unit_price)} per #{per}"
      @total = "#{@order.price_currency} #{ActiveSupport::NumberHelper.number_to_delimited(format('%.2f', @order.unit_price * @order.qty))}"
    end
    # The saved purchase order PDF goes with the email.
    attachments["#{@order.number}.pdf"] = { mime_type: "application/pdf", content: @order.pdf_document }
    subject = "Purchase order #{@order.number} from SASH"
    subject = "[Forward to #{@order.vendor.name}] #{subject}" if @fallback
    mail(to: params.fetch(:recipients), subject: subject, options: { idempotency_key: "vendor-order-#{@order.id}-#{@order.created_at.to_i}" })
  end

  private

  # Up to 4 decimals, without trailing zeros (0.425, 60).
  def format_amount(value)
    ActiveSupport::NumberHelper.number_to_delimited(value.to_d.round(4).to_s("F").sub(/\.?0+\z/, ""))
  end
end
