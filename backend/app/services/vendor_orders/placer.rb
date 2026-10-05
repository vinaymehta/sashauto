module VendorOrders
  # Places one order row with vendors: one Vendor Order per selected vendor, in one transaction.
  #
  #   allocations: [{ vendor_id:, qty: }]
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

    def self.call(row:, allocations:, user:)
      new(row, allocations, user).call
    end

    def initialize(row, allocations, user)
      @row = row
      @allocations = Array(allocations)
      @user = user
    end

    def call
      product = Product.find_by(part_number: @row.part_number)
      order_qty = @row.qty
      raise Invalid, "This order has no Qty, so it cannot be placed." if order_qty.nil? || order_qty <= 0

      links = product ? product.vendor_products.includes(:vendor).index_by(&:vendor_id) : {}
      lines = parse(links)
      total = lines.sum { |l| l[:qty] }
      unless total == order_qty
        raise Invalid.new("The allocated total (#{fmt(total)}) must equal the order Qty (#{fmt(order_qty)}).",
                          { total: [ "must equal #{fmt(order_qty)}" ] })
      end

      placement = nil
      VendorOrderPlacement.transaction do
        key = VendorOrderPlacement.order_key(@row)
        raise Invalid, "This order was already placed with vendors." if VendorOrderPlacement.exists?(order_key: key)

        placement = VendorOrderPlacement.create!(
          order_key: key, **order_reference, product: product,
          po_number: @row.po_number, po_line_number: @row.po_line_number, part_number: @row.part_number,
          order_type: @row.order_type, ship_date: @row.ship_date, due_date: @row.due_date, unit: @row.unit&.strip,
          order_qty: order_qty, moq: product&.moq, placed_by: @user, placed_at: Time.current
        )
        lines.each do |line|
          link = links.fetch(line[:vendor_id])
          VendorOrder.create!(vendor_order_placement: placement, vendor: link.vendor, number: VendorOrder.next_number,
                              qty: line[:qty], unit_price: link.price_amount, price_currency: link.price_currency,
                              price_note: link.price_note, email_status: "pending")
        end
      end
      Result.new(placement: placement, warnings: moq_warnings(placement))
    rescue ActiveRecord::RecordNotUnique
      raise Invalid, "This order was already placed with vendors."
    end

    # The placed order: an imported order row (with its upload) or a manual order.
    def order_reference
      @row.is_a?(ManualOrder) ? { manual_order: @row } : { order_row: @row, upload_batch_id: @row.upload_batch_id }
    end

    # MOQ warnings for a placement's allocations (never blocking).
    def self.moq_warnings(placement)
      moq = placement.moq
      return [] unless moq

      placement.vendor_orders.includes(:vendor).select { |vo| vo.qty < moq }.map do |vo|
        { vendor_order_id: vo.id, vendor_id: vo.vendor_id, vendor_name: vo.vendor.name,
          message: "#{vo.vendor.name}: #{fmt(vo.qty)} is below the MOQ of #{fmt(moq)}." }
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
        raise Invalid.new("Allocation #{i + 1}: choose a vendor linked to this part.", { vendor_id: [ "is not linked to this part" ] }) unless vendor_id && links[vendor_id]
        raise Invalid, "#{links[vendor_id].vendor.name} is selected more than once." if seen[vendor_id]
        unless qty.match?(/\A\d+(\.\d{1,3})?\z/) && qty.to_d.positive?
          raise Invalid.new("#{links[vendor_id].vendor.name}: enter a quantity greater than 0 (up to 3 decimals).", { qty: [ "is invalid" ] })
        end

        seen[vendor_id] = true
        { vendor_id: vendor_id, qty: qty.to_d }
      end
    end
  end
end
