module Api
  # Products page, Current inventory tab: the vendor parts with an "Current Inventory" quantity (pieces the vendor has
  # now), by Part Number then vendor. Search: q (part, SASH part, vendor part, description or vendor).
  class AvailablePartsController < ApplicationController
    def index
      scope = VendorProduct.joins(:product, :vendor).where("vendor_products.available_qty > 0")
      if params[:q].present?
        term = "%#{VendorProduct.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("products.part_number ILIKE :t OR vendor_products.sash_part ILIKE :t OR vendor_products.vendor_part ILIKE :t OR " \
                            "vendor_products.description ILIKE :t OR vendors.name ILIKE :t", t: term)
      end

      items, meta = paginate(scope.includes(:product, :vendor).order("products.part_number", "vendors.name", :id))
      render json: { data: items.map { |vp| Serializers.vendor_product(vp) }, meta: meta }
    end
  end
end
