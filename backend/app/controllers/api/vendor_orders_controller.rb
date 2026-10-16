module Api
  # Vendor orders of one order row (the Orders page detail). Reading is open to signed-in users; generating the POs
  # and ticking "Order placed" is admin-only. POs are not emailed from the app.
  class VendorOrdersController < ApplicationController
    before_action -> { require_role(:admin) }, only: %i[create preview preview_letter update]
    rate_limit to: 60, within: 1.hour, only: :create, store: RATE_LIMIT_STORE, by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many placements in a short time. Try again later.", :too_many_requests }

    # The placements of this row (also from earlier uploads), the Qty ordered and still to order, and the vendors it
    # can be ordered from.
    def show
      row = order
      placements = placements_for(row)
      ordered = placements.sum(&:ordered)
      remaining = [ order_qty(row).to_d - ordered, 0 ].max
      product = Product.find_by(part_number: row.part_number)
      vendors = product ? product.vendor_products.includes(:vendor).joins(:vendor).order("vendors.name") : []
      render json: {
        data: {
          order: { id: row.id, po_number: row.po_number, po_line_number: row.po_line_number, part_number: row.part_number,
                   order_type: row.order_type, ship_date: row.ship_date, qty: Serializers.qty(order_qty(row)),
                   ordered: Serializers.qty(ordered), remaining: Serializers.qty(remaining),
                   combined: combined_group(row)&.members&.size },
          # Order Qty counts sets; the part's MOQ in sets and pieces, and how many pieces make a set.
          moq: Serializers.qty(product && (product.moq_sets || product.moq)), moq_pcs: Serializers.qty(product&.moq),
          pack_size: product&.pack_size || 1,
          vendors: vendors.map { |vp| Serializers.product_vendor(vp) },
          placements: placements.map { |p| Serializers.vendor_order_placement(p) },
          warnings: placements.flat_map { |p| VendorOrders::Placer.moq_warnings(p) },
          can_place: current_user.admin? && remaining.positive?
        }
      }
    end

    def create
      row = order
      allocations = params.permit(allocations: %i[vendor_id qty unit ship_date]).fetch(:allocations, [])
      result = VendorOrders::Placer.call(row: row, allocations: allocations, user: current_user, order_qty: order_qty(row))
      placement = result.placement
      audit("vendor_order.placed", subject: placement, po_number: placement.po_number, part_number: placement.part_number,
            vendor_orders: placement.vendor_orders.map { |vo| { number: vo.number, vendor_id: vo.vendor_id, qty: vo.qty.to_s } })
      render json: { data: Serializers.vendor_order_placement(placement.reload), warnings: result.warnings }, status: :created
    rescue VendorOrders::Placer::Invalid => e
      render_error e.message, :unprocessable_content, details: e.details.presence
    end

    # The PDF a placement would create for one vendor (DRAFT, not saved): POST with the allocations and vendor_id.
    def preview
      row = order
      pdf = VendorOrders::Placer.preview(row: row, allocations: params.permit(allocations: %i[vendor_id qty unit ship_date]).fetch(:allocations, []),
                                         user: current_user, vendor_id: params.require(:vendor_id), order_qty: order_qty(row))
      send_data pdf, filename: "purchase-order-draft.pdf", type: "application/pdf", disposition: "inline"
    rescue VendorOrders::Placer::Invalid => e
      render_error e.message, :unprocessable_content
    end

    # The Intimation Letter the PO would come with for one vendor (DRAFT, not saved): POST with vendor_id.
    def preview_letter
      row = order
      product = Product.find_by(part_number: row.part_number)
      link = product&.vendor_products&.find_by(vendor_id: params.require(:vendor_id))
      return render_error("Choose a vendor linked to this part.", :unprocessable_content) unless link

      send_data VendorOrders::IntimationLetter.preview(vendor: link.vendor), filename: "intimation-letter-draft.pdf",
                                                                            type: "application/pdf", disposition: "inline"
    end

    # The saved Intimation Letter of a vendor order.
    def letter
      vendor_order = VendorOrder.find(params[:id])
      send_data vendor_order.letter_document, filename: vendor_order.letter_file_name, type: "application/pdf",
                                              disposition: params[:download] == "1" ? "attachment" : "inline"
    end

    # The saved purchase order PDF of a vendor order.
    def pdf
      vendor_order = VendorOrder.find(params[:id])
      send_data vendor_order.pdf_document, filename: vendor_order.file_name, type: "application/pdf",
                                           disposition: params[:download] == "1" ? "attachment" : "inline"
    end

    # "Order placed" tick of a generated PO (the admin sent it to the vendor): PATCH { order_placed: true | false }.
    def update
      order = VendorOrder.find(params[:id])
      placed = ActiveModel::Type::Boolean.new.cast(params.require(:order_placed))
      order.update!(order_placed_at: placed ? Time.current : nil, order_placed_by: placed ? current_user : nil)
      audit(placed ? "vendor_order.marked_placed" : "vendor_order.unmarked_placed", subject: order, number: order.number)
      render json: { data: Serializers.vendor_order(order) }
    end

    private

    # The order row, or (`manual=1`) the manual order, with this id.
    def order
      params[:manual] == "1" ? ManualOrder.active.find(params[:order_id]) : OrderRow.find(params[:order_id])
    end

    # The combined order this row starts (Orders::Combiner), if any.
    def combined_group(row)
      return nil unless row.is_a?(OrderRow)
      group = Orders::Combiner.call(row.upload_batch_id).groups[row.id]
      group if group&.combined?
    end

    # Qty to place: a combined order's total, else the row's Qty.
    def order_qty(row)
      combined_group(row)&.total || row.qty
    end

    def placements_for(row)
      VendorOrderPlacement.includes(:placed_by, vendor_orders: %i[vendor order_placed_by])
                          .where(order_key: VendorOrderPlacement.order_key(row)).order(:placed_at).to_a
    end
  end
end
