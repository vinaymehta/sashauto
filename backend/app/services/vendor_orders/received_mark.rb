module VendorOrders
  # Connects Purchase orders to the Orders page: once every vendor PO of an order (all its placements' vendor orders)
  # is received in full (VendorOrder#goods_received_at, from the receipts), the order is marked "Received at SASH
  # Faridabad" with the vendor invoices and the last date received; when a receipt is removed and that no longer holds,
  # the mark this made is removed again. A Received mark made otherwise (by hand, the dispatched orders list) is left
  # as it is.
  #
  #   VendorOrders::ReceivedMark.sync(placement, user)
  class ReceivedMark
    NOTE = "Goods received from the vendor: ".freeze

    def self.sync(placement, user)
      key = placement.order_key
      orders = VendorOrder.joins(:vendor_order_placement).where(vendor_order_placements: { order_key: key }).includes(:receipts)
      full = orders.any? && orders.all? { |o| o.goods_received_at.present? }
      marks = OrderDelivery.active.where(order_key: key, kind: "received")
      mine = marks.where("note LIKE ?", "#{NOTE}%")
      if full && !marks.exists?
        receipts = orders.flat_map(&:receipts)
        order = placement.order_row || placement.manual_order
        OrderDelivery.create!(order_key: key, kind: "received", order_row: placement.order_row, manual_order: placement.manual_order,
                              po_number: order.po_number, po_line_number: order.po_line_number, part_number: order.part_number,
                              order_type: order.order_type, ship_date: placement.order_row ? order.ship_date : placement.ship_date,
                              delivered_on: receipts.map(&:received_on).max || Date.current,
                              invoice_number: receipts.map(&:invoice_number).uniq.join(", ").first(255),
                              note: "#{NOTE}#{orders.map { |o| o.vendor.name }.uniq.join(', ')} (#{orders.map(&:number).uniq.join(', ')})".first(500),
                              marked_by: user)
      elsif !full
        mine.find_each { |m| m.update!(removed_at: Time.current, removed_by: user) }
      end
    end
  end
end
