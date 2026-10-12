# One Vendor Order sent to its vendor: only that vendor's order, without prices. When the vendor has no email
# address it goes to the default recipients instead (`fallback`), with a note to forward it to the vendor.
class VendorOrderMailer < ApplicationMailer
  def placed
    @order = params.fetch(:vendor_order)
    @placement = @order.vendor_order_placement
    @product = @placement.product
    @fallback = params.fetch(:fallback, false)
    # Pieces per set, for the quantity line ("200 sets of 10 pcs (2,000 pcs)" / "500 pcs").
    @pack = @order.vendor.vendor_products.find_by(product_id: @placement.product_id)&.pack_size || @product&.pack_size || 1
    subject = "Purchase order #{@order.number} from SASH"
    subject = "[Forward to #{@order.vendor.name}] #{subject}" if @fallback
    mail(to: params.fetch(:recipients), subject: subject, options: { idempotency_key: "vendor-order-#{@order.id}-#{@order.created_at.to_i}" })
  end
end
