# One Vendor Order sent to its vendor: only that vendor's order, without prices. When the vendor has no email
# address it goes to the default recipients instead (`fallback`), with a note to forward it to the vendor.
class VendorOrderMailer < ApplicationMailer
  def placed
    @order = params.fetch(:vendor_order)
    @placement = @order.vendor_order_placement
    @product = @placement.product
    @fallback = params.fetch(:fallback, false)
    subject = "Purchase order #{@order.number} from SASH: #{@placement.part_number}"
    subject = "[Forward to #{@order.vendor.name}] #{subject}" if @fallback
    mail(to: params.fetch(:recipients), subject: subject, options: { idempotency_key: "vendor-order-#{@order.id}" })
  end
end
