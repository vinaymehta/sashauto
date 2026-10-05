module Api
  # Vendor orders of one order row (the Orders page detail). Reading is open to signed-in users;
  # placing and retrying emails is admin-only.
  class VendorOrdersController < ApplicationController
    before_action -> { require_role(:admin) }, only: %i[create retry_email]
    rate_limit to: 60, within: 1.hour, only: :create, store: RATE_LIMIT_STORE, by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many placements in a short time. Try again later.", :too_many_requests }

    # The placement of this row (if placed, also from an earlier upload), or the vendors it can be placed with.
    def show
      row = OrderRow.find(params[:order_id])
      placement = placement_for(row)
      product = Product.find_by(part_number: row.part_number)
      vendors = product ? product.vendor_products.includes(:vendor).joins(:vendor).order("vendors.name") : []
      render json: {
        data: {
          order: { id: row.id, po_number: row.po_number, po_line_number: row.po_line_number, part_number: row.part_number,
                   order_type: row.order_type, ship_date: row.ship_date, qty: Serializers.qty(row.qty) },
          moq: Serializers.qty(product&.moq),
          vendors: vendors.map { |vp| Serializers.product_vendor(vp).merge(has_email: vp.vendor.email.present?) },
          placement: placement && Serializers.vendor_order_placement(placement),
          warnings: placement ? VendorOrders::Placer.moq_warnings(placement) : [],
          can_place: placement.nil? && current_user.admin? && row.qty.to_d.positive?
        }
      }
    end

    def create
      row = OrderRow.find(params[:order_id])
      allocations = params.permit(allocations: %i[vendor_id qty]).fetch(:allocations, [])
      result = VendorOrders::Placer.call(row: row, allocations: allocations, user: current_user)
      placement = result.placement
      audit("vendor_order.placed", subject: placement, po_number: placement.po_number, part_number: placement.part_number,
            vendor_orders: placement.vendor_orders.map { |vo| { number: vo.number, vendor_id: vo.vendor_id, qty: vo.qty.to_s } })
      placement.vendor_orders.each { |vo| VendorOrders::DeliverJob.dispatch(vo) }
      render json: { data: Serializers.vendor_order_placement(placement.reload), warnings: result.warnings }, status: :created
    rescue VendorOrders::Placer::Invalid => e
      render_error e.message, :unprocessable_content, details: e.details.presence
    end

    # Sends a failed / not-sent vendor email again (e.g. after the vendor's email address was added).
    def retry_email
      order = VendorOrder.find(params[:id])
      return render_error("This email was already sent.", :conflict) if order.email_sent?

      order.update!(email_status: "pending", email_last_error: nil)
      VendorOrders::DeliverJob.dispatch(order)
      audit("vendor_order.email_retry_requested", subject: order)
      render json: { data: Serializers.vendor_order(order) }, status: :accepted
    end

    private

    def placement_for(row)
      VendorOrderPlacement.includes(:placed_by, vendor_orders: :vendor).find_by(order_key: VendorOrderPlacement.order_key(row))
    end
  end
end
