# Tells the admins (the India team) that the Warehouse Manager marked an order delivered: inbound (received at
# SASH US) or outbound (delivered to Deere).
class OrderDeliveryMailer < ApplicationMailer
  def marked
    @delivery = params.fetch(:delivery)
    @url = "#{AppConfig.app_url}/orders"
    direction = @delivery.kind == "inbound" ? "Inbound" : "Outbound"
    mail(to: params.fetch(:recipients), subject: "#{direction}: PO #{@delivery.po_number} · #{@delivery.part_number} · #{@delivery.label}",
         options: { idempotency_key: "order-delivery-#{@delivery.id}-#{@delivery.created_at.to_i}" })
  end
end
