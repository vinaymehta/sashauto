module VendorOrders
  # Places one order row with vendors: one Vendor Order per selected vendor, in one transaction.
  #
  #   allocations: [{ vendor_id:, qty:, unit:, ship_date: }]  (ship_date: YYYY-MM-DD, defaults to the order's Ship Date)
  #
  # Rules: at least one vendor; each vendor once and linked to the row's Part Number (Vendors list);
  # every qty a number > 0; the total equals the row's Qty exactly. The original order row is not changed.
  # MOQ is never enforced: allocations below the Product MOQ are returned as warnings only.
  # A row (PO + Part + Type + PO Line + Ship Date) can be placed once; later attempts are refused.
  class Placer
    class Invalid < StandardError
      attr_reader :details

      def initialize(message, details = {})
        super(message)
        @details = details
      end
    end

    Result = Data.define(:placement, :warnings)

    # `order_qty`: the Qty to place — a combined order's total (Orders::Combiner); the row's own Qty by default.
    def self.call(row:, allocations:, user:, order_qty: nil)
      new(row, allocations, user, order_qty).call
    end

    def initialize(row, allocations, user, order_qty = nil)
      @order_qty = order_qty
      @row = row
      @allocations = Array(allocations)
      @user = user
    end

    def call
      product = Product.find_by(part_number: @row.part_number)
      order_qty = @order_qty || @row.qty
      raise Invalid, "This order has no Qty, so it cannot be placed." if order_qty.nil? || order_qty <= 0

      links = product ? product.vendor_products.includes(:vendor).index_by(&:vendor_id) : {}
      lines = parse(links)
      # Order Qty counts sets; an allocation in pieces counts as pieces ÷ the vendor's pack size.
      total = lines.sum { |l| l[:sets] }
      unless total == order_qty
        raise Invalid.new("The allocated total (#{fmt(total)} sets) must equal the order Qty (#{fmt(order_qty)} sets).",
                          { total: [ "must equal #{fmt(order_qty)} sets" ] })
      end

      placement = nil
      VendorOrderPlacement.transaction do
        key = VendorOrderPlacement.order_key(@row)
        raise Invalid, "This order was already placed with vendors." if VendorOrderPlacement.exists?(order_key: key)

        placement = VendorOrderPlacement.create!(
          order_key: key, **order_reference, product: product,
          po_number: @row.po_number, po_line_number: @row.po_line_number, part_number: @row.part_number,
          order_type: @row.order_type, ship_date: @row.ship_date, due_date: @row.due_date, unit: @row.unit&.strip,
          order_qty: order_qty, moq: product && (product.moq_sets || product.moq), placed_by: @user, placed_at: Time.current
        )
        lines.each do |line|
          link = links.fetch(line[:vendor_id])
          VendorOrder.create!(vendor_order_placement: placement, vendor: link.vendor, number: VendorOrder.next_number,
                              qty: line[:qty], unit: line[:unit], ship_date: line[:ship_date] || default_ship_date,
                              unit_price: line[:unit] == "pcs" ? link.price_amount : link.set_price_amount,
                              price_currency: link.price_currency, price_note: link.price_note, email_status: "not_sent")
        end
      end
      # Each vendor's purchase order is saved as a PDF (no email; an admin can email it later).
      placement.vendor_orders.each(&:attach_pdf)
      Result.new(placement: placement, warnings: moq_warnings(placement))
    rescue ActiveRecord::RecordNotUnique
      raise Invalid, "This order was already placed with vendors."
    end

    # The PDF that placing would create for one vendor of the allocation (not saved, marked DRAFT).
    def self.preview(row:, allocations:, user:, vendor_id:, order_qty: nil)
      new(row, allocations, user, order_qty).preview(Integer(vendor_id, exception: false))
    end

    def preview(vendor_id)
      product = Product.find_by(part_number: @row.part_number)
      links = product ? product.vendor_products.includes(:vendor).index_by(&:vendor_id) : {}
      line = parse(links).find { |l| l[:vendor_id] == vendor_id }
      raise Invalid, "Select this vendor and enter its quantity first." unless line

      link = links.fetch(vendor_id)
      PdfBuilder.preview(vendor: link.vendor, product: product, link: link, qty: line[:qty], unit: line[:unit],
                         unit_price: line[:unit] == "pcs" ? link.price_amount : link.set_price_amount,
                         required_by: line[:ship_date] || default_ship_date, prepared_by: @user.name)
    end

    # Vendors ship this many days before the order's ship date, unless a date is chosen (not before today).
    VENDOR_LEAD_DAYS = 60

    def default_ship_date
      [ @row.ship_date - VENDOR_LEAD_DAYS, Date.current ].max
    end

    # The placed order: an imported order row (with its upload) or a manual order.
    def order_reference
      @row.is_a?(ManualOrder) ? { manual_order: @row } : { order_row: @row, upload_batch_id: @row.upload_batch_id }
    end

    # MOQ warnings for a placement's allocations (never blocking): each vendor order is checked against that
    # vendor's MOQ in the unit it was placed in (sets or pieces), else the part's MOQ.
    def self.moq_warnings(placement)
      links = VendorProduct.where(product_id: placement.product_id).index_by(&:vendor_id)
      placement.vendor_orders.includes(:vendor).filter_map do |vo|
        moq = moq_for(links[vo.vendor_id], placement, vo.unit)
        next unless moq && vo.qty < moq

        { vendor_order_id: vo.id, vendor_id: vo.vendor_id, vendor_name: vo.vendor.name,
          message: "#{vo.vendor.name}: #{fmt(vo.qty)} #{vo.unit} is below the MOQ of #{fmt(moq)} #{vo.unit}." }
      end
    end

    def self.moq_for(link, placement, unit)
      if unit == "pcs"
        link&.moq || placement.product&.moq
      else
        link&.moq_sets || placement.moq
      end
    end

    def self.fmt(number)
      Serializers.qty(number)
    end

    private

    def fmt(number) = self.class.fmt(number)
    def moq_warnings(placement) = self.class.moq_warnings(placement)

    def parse(links)
      raise Invalid, "Select at least one vendor." if @allocations.empty?

      seen = {}
      @allocations.map.with_index do |a, i|
        a = a.to_h.symbolize_keys
        vendor_id = Integer(a[:vendor_id], exception: false)
        qty = a[:qty].to_s.strip
        unit = a[:unit].to_s.presence || "sets"
        raise Invalid.new("Allocation #{i + 1}: the unit must be sets or pcs.", { unit: [ "is invalid" ] }) unless %w[sets pcs].include?(unit)
        raise Invalid.new("Allocation #{i + 1}: choose a vendor linked to this part.", { vendor_id: [ "is not linked to this part" ] }) unless vendor_id && links[vendor_id]
        raise Invalid, "#{links[vendor_id].vendor.name} is selected more than once." if seen[vendor_id]
        unless qty.match?(/\A\d+(\.\d{1,3})?\z/) && qty.to_d.positive?
          raise Invalid.new("#{links[vendor_id].vendor.name}: enter a quantity greater than 0 (up to 3 decimals).", { qty: [ "is invalid" ] })
        end

        ship_date = a[:ship_date].to_s.strip.presence
        ship_date &&= (Date.iso8601(ship_date) rescue nil) || raise(Invalid.new("#{links[vendor_id].vendor.name}: enter a valid ship date.", { ship_date: [ "is invalid" ] }))

        seen[vendor_id] = true
        pack = [ links[vendor_id].pack_size.to_i, 1 ].max
        { vendor_id: vendor_id, qty: qty.to_d, unit: unit, ship_date: ship_date,
          sets: unit == "pcs" ? (qty.to_d / pack).round(3) : qty.to_d }
      end
    end
  end
end
