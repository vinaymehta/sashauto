module Api
  # Inbound / outbound delivery marks on an order row. The Warehouse Manager (or an admin) marks; only an admin
  # removes a wrong mark. Each mark emails the admins (the India team) and shows in their notification bell.
  class OrderDeliveriesController < ApplicationController
    before_action -> { require_role(:admin) }, only: :destroy

    def create
      row = params[:manual] == "1" ? ManualOrder.active.find(params[:order_id]) : OrderRow.find(params[:order_id])
      kind = params.require(:kind).to_s
      return render_error("Unknown delivery type.", :unprocessable_content) unless OrderDelivery::KINDS.include?(kind)

      delivered_on = params[:delivered_on].present? ? (Date.iso8601(params[:delivered_on].to_s) rescue nil) : Time.zone.today
      return render_error("Enter a valid delivery date.", :unprocessable_content, details: { delivered_on: [ "is invalid" ] }) unless delivered_on
      return already_marked(kind) if OrderDelivery.active.exists?(order_key: VendorOrderPlacement.order_key(row), kind: kind)

      delivery = OrderDelivery.create!(
        order_key: VendorOrderPlacement.order_key(row), kind: kind,
        **(row.is_a?(ManualOrder) ? { manual_order: row } : { order_row: row }),
        po_number: row.po_number, po_line_number: row.po_line_number, part_number: row.part_number,
        order_type: row.order_type, ship_date: row.ship_date, delivered_on: delivered_on,
        note: params[:note].to_s.strip.first(500).presence, marked_by: current_user
      )
      audit("order.delivery_marked", subject: delivery, kind: kind, po_number: row.po_number, part_number: row.part_number)
      recipients = Notifications::Outbox.recipients
      OrderDeliveryMailer.with(delivery: delivery, recipients: recipients).marked.deliver_later if recipients.any?
      render json: { data: Serializers.order_delivery(delivery) }, status: :created
    rescue ActiveRecord::RecordNotUnique
      already_marked(kind)
    end

    def destroy
      delivery = OrderDelivery.active.find(params[:id])
      delivery.update!(removed_at: Time.current, removed_by: current_user)
      audit("order.delivery_removed", subject: delivery, kind: delivery.kind, po_number: delivery.po_number, part_number: delivery.part_number)
      head :no_content
    end

    private

    def already_marked(kind)
      render_error "This order is already marked \"#{OrderDelivery::LABELS.fetch(kind)}\".", :conflict
    end
  end
end
