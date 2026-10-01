module Api
  # The parts of one vendor, with that vendor's details for each. Changes are admin-only.
  class VendorProductsController < ApplicationController
    FIELDS = %i[sash_part vendor_part description moq weight_kg price_amount price_currency price_note].freeze

    before_action -> { require_role(:admin) }, except: :index
    before_action :load_vendor

    def index
      scope = @vendor.vendor_products.joins(:product).includes(:product).order("products.part_number", :id)
      if params[:q].present?
        term = "%#{VendorProduct.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("products.part_number ILIKE :t OR vendor_products.sash_part ILIKE :t OR " \
                            "vendor_products.vendor_part ILIKE :t OR vendor_products.description ILIKE :t", t: term)
      end
      render json: { data: scope.limit(1_000).map { |vp| Serializers.vendor_product(vp) } }
    end

    def create
      product = Product.find_by(part_number: OrderRows::Normalizer.part_number(params.require(:part_number).to_s))
      return render_error("This Part Number is not in Products.", :unprocessable_content, details: { part_number: [ "is not in Products" ] }) unless product

      item = @vendor.vendor_products.new(product: product, **attributes)
      save(item, "vendor_product.created", :created)
    rescue ActiveRecord::RecordNotUnique
      render_error "This part is already listed for this vendor.", :unprocessable_content
    end

    # The Part Number of an entry cannot change; delete it and add the other part instead.
    def update
      item = @vendor.vendor_products.find(params[:id])
      item.assign_attributes(attributes)
      save(item, "vendor_product.updated", :ok)
    end

    def destroy
      item = @vendor.vendor_products.includes(:product).find(params[:id])
      item.destroy!
      audit("vendor_product.deleted", subject: item, vendor_id: @vendor.id, part_number: item.product.part_number)
      head :no_content
    end

    private

    def load_vendor
      @vendor = Vendor.find(params[:vendor_id])
    end

    def attributes
      params.permit(*FIELDS).to_h.symbolize_keys.transform_values { |v| v.is_a?(String) && v.strip.empty? ? nil : v }
            .tap { |attrs| attrs[:price_currency] ||= "INR" if attrs.key?(:price_currency) }
    end

    def save(item, action, status)
      if item.save
        audit(action, subject: item, vendor_id: @vendor.id, part_number: item.product.part_number)
        render json: { data: Serializers.vendor_product(item) }, status: status
      else
        render_error item.errors.full_messages.to_sentence, :unprocessable_content, details: item.errors.to_hash
      end
    end
  end
end
