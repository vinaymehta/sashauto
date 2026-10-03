module Api
  class ProductsController < ApplicationController
    SORTS = {
      "part_number" => "products.part_number", "commodity_type" => "products.commodity_type",
      "source" => "products.source", "moq" => "products.moq", "updated_at" => "products.updated_at",
      "sash_part" => "products.sash_part", "vendor_part" => "products.vendor_part",
      "description" => "products.description", "weight_kg" => "products.weight_kg"
    }.freeze

    before_action -> { require_role(:admin) }, only: :update

    def index
      scope = Product.all
      if params[:q].present?
        term = "%#{Product.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("part_number ILIKE :t OR commodity_type ILIKE :t OR sash_part ILIKE :t OR " \
                            "vendor_part ILIKE :t OR description ILIKE :t", t: term)
      end
      scope = scope.where(id: ProductConflict.open.select(:product_id)) if params[:conflicts] == "open"
      scope = scope.where(source: params[:source]) if Product::SOURCES.include?(params[:source])
      scope, sort, direction = apply_sort(scope, SORTS, default: "part_number")

      products, meta = paginate(scope)
      meta = meta.merge(sort: sort, direction: direction)
      conflicts = ProductConflict.open.includes(:upload_batch).where(product_id: products.map(&:id)).order(:created_at).group_by(&:product_id)
      render json: { data: products.map { |p| Serializers.product(p, open_conflicts: conflicts.fetch(p.id, [])) }, meta: meta }
    end

    # Vendors supplying this product, with each vendor's price (from the Vendors list).
    def vendors
      product = Product.find(params[:id])
      items = product.vendor_products.includes(:vendor).joins(:vendor).order("vendors.name")
      render json: { data: items.map { |vp| Serializers.product_vendor(vp) } }
    end

    def create
      product = Product.new(part_number: params.require(:part_number), commodity_type: params[:commodity_type],
                            source: "manual", created_by: current_user)
      if product.save
        audit("product.created", subject: product, part_number: product.part_number, commodity_type: product.commodity_type)
        render json: { data: Serializers.product(product) }, status: :created
      else
        render_validation_errors(product)
      end
    rescue ActiveRecord::RecordNotUnique
      render_error "A product with this Part Number already exists.", :unprocessable_content
    end

    # Only the MOQ can be edited (admins). Blank clears it. Used for MOQ alerts on the next upload.
    def update
      product = Product.find(params[:id])
      before = product.moq
      if product.update(moq: params[:moq].presence)
        audit("product.moq_updated", subject: product, moq_before: before&.to_s, moq_after: product.moq&.to_s)
        render json: { data: Serializers.product(product, open_conflicts: product.product_conflicts.open.includes(:upload_batch)) }
      else
        render_validation_errors(product)
      end
    end

    private

    def render_validation_errors(product)
      render_error product.errors.full_messages.to_sentence, :unprocessable_content, details: product.errors.to_hash
    end
  end
end
