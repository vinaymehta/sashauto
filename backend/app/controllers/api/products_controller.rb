module Api
  class ProductsController < ApplicationController
    SORTS = {
      "part_number" => "products.part_number", "commodity_type" => "products.commodity_type",
      "source" => "products.source", "moq" => "products.moq", "updated_at" => "products.updated_at",
      "sash_part" => "products.sash_part", "vendor_part" => "products.vendor_part",
      "description" => "products.description", "weight_kg" => "products.weight_kg"
    }.freeze

    before_action -> { require_role(:admin) }, only: %i[create update]
    # Part details the SASH team adds or edits by hand (the Part Number never changes: orders match on it). An upload
    # only fills a blank Commodity Type, so an edited one stays.
    DETAILS = %i[description sash_part vendor_part commodity_type].freeze

    VENDOR_COUNT = "(SELECT COUNT(*) FROM vendor_products vp WHERE vp.product_id = products.id)".freeze
    # List filters (each several values, any of them matches): value => SQL condition.
    FILTERS = {
      vendors: { "none" => "#{VENDOR_COUNT} = 0", "one" => "#{VENDOR_COUNT} = 1", "many" => "#{VENDOR_COUNT} > 1" },
      vendor_price: {
        "set" => "EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.product_id = products.id AND vp.price_amount IS NOT NULL)",
        "missing" => "NOT EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.product_id = products.id AND vp.price_amount IS NOT NULL)"
      },
      available: {
        "yes" => "EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.product_id = products.id AND vp.available_qty > 0)",
        "no" => "NOT EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.product_id = products.id AND vp.available_qty > 0)"
      },
      customer_price: { "set" => "products.customer_price IS NOT NULL", "missing" => "products.customer_price IS NULL" },
      moq: { "set" => "products.moq IS NOT NULL", "missing" => "products.moq IS NULL" },
      pack: { "single" => "products.pack_size <= 1", "sets" => "products.pack_size > 1" }
    }.freeze
    NO_COMMODITY = "_none".freeze

    def index
      scope = Product.all
      if params[:q].present?
        term = "%#{Product.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("part_number ILIKE :t OR commodity_type ILIKE :t OR sash_part ILIKE :t OR " \
                            "vendor_part ILIKE :t OR description ILIKE :t", t: term)
      end
      scope = scope.where(id: ProductConflict.open.select(:product_id)) if params[:conflicts] == "open"
      scope = scope.where(source: params[:source]) if Product::SOURCES.include?(params[:source])
      scope = filter_by_commodity(scope)
      FILTERS.each { |name, conditions| scope = where_any(scope, name, conditions) }
      scope, sort, direction = apply_sort(scope, SORTS, default: "part_number")

      products, meta = paginate(scope)
      meta = meta.merge(sort: sort, direction: direction)
      conflicts = ProductConflict.open.includes(:upload_batch).where(product_id: products.map(&:id)).order(:created_at).group_by(&:product_id)
      vendors = VendorProduct.includes(:vendor).where(product_id: products.map(&:id)).group_by(&:product_id)
      render json: { data: products.map { |p| Serializers.product(p, open_conflicts: conflicts.fetch(p.id, []), vendors: vendors.fetch(p.id, [])) },
                     meta: meta, facets: { commodity_types: Product.where.not(commodity_type: nil).distinct.order(:commodity_type).pluck(:commodity_type) } }
    end

    # The part panel: the product, the vendors supplying it with each vendor's price, MOQ and Available Parts, the
    # customer price and the price history (customer and vendor prices, newest first).
    def vendors
      product = Product.find(params[:id])
      items = product.vendor_products.includes(:vendor).joins(:vendor).order("vendors.name")
      history = product.price_changes.includes(:changed_by, :upload_batch).order(created_at: :desc, id: :desc).limit(200)
      render json: { product: Serializers.product(product, open_conflicts: product.product_conflicts.open.includes(:upload_batch)),
                     data: items.map { |vp| Serializers.product_vendor(vp) },
                     customer_price: Serializers.qty(product.customer_price),
                     history: history.map { |change| Serializers.price_change(change) } }
    end

    # A part added by the SASH team (Products → Add part): Part Number, details, pack, MOQ (sets) and customer price.
    def create
      product = Product.new(part_number: params.require(:part_number), commodity_type: params[:commodity_type].presence,
                            source: "manual", created_by: current_user, **details,
                            pack_size: params[:pack_size].presence || 1, moq_sets: params[:moq_sets].presence,
                            customer_price: params[:customer_price].presence)
      product.price_changed_by = current_user
      if product.save
        audit("product.created", subject: product, part_number: product.part_number, commodity_type: product.commodity_type)
        render json: { data: Serializers.product(product) }, status: :created
      else
        render_validation_errors(product)
      end
    rescue ActiveRecord::RecordNotUnique
      render_error "A product with this Part Number already exists.", :unprocessable_content
    end

    # Admins edit the description, SASH / vendor part, pack, MOQ (used for MOQ alerts on the next upload) and customer
    # price. Blank clears a value.
    def update
      product = Product.find(params[:id])
      before = { moq: product.moq&.to_s, moq_sets: product.moq_sets&.to_s, pack_size: product.pack_size,
                 customer_price: product.customer_price&.to_s, **product.slice(*DETAILS).symbolize_keys }
      # MOQ in sets with the pack size (pieces derived), or — from older clients — MOQ in pieces.
      attrs = details
      attrs[:pack_size] = params[:pack_size] if params.key?(:pack_size)
      if params.key?(:moq_sets)
        attrs[:moq_sets] = params[:moq_sets].presence
      elsif params.key?(:moq)
        attrs[:moq] = params[:moq].presence
      end
      # Customer price (Unit Price per 100 pcs), edited by hand; the change goes to the price history.
      attrs[:customer_price] = params[:customer_price].presence if params.key?(:customer_price)
      product.price_changed_by = current_user
      if product.update(attrs)
        audit("product.updated", subject: product, before: before,
                                 after: { moq: product.moq&.to_s, moq_sets: product.moq_sets&.to_s, pack_size: product.pack_size,
                                          customer_price: product.customer_price&.to_s, **product.slice(*DETAILS).symbolize_keys })
        render json: { data: Serializers.product(product, open_conflicts: product.product_conflicts.open.includes(:upload_batch)) }
      else
        render_validation_errors(product)
      end
    end

    private

    # Commodity Type filter: the chosen types, "_none" for parts without one.
    def filter_by_commodity(scope)
      types = multi_param(:commodity_type)
      return scope if types.empty?

      values = types - [ NO_COMMODITY ]
      values << nil if types.include?(NO_COMMODITY)
      scope.where(commodity_type: values)
    end

    # The details given in the request (blank clears one).
    def details
      DETAILS.select { |f| params.key?(f) }.to_h { |f| [ f, params[f].to_s.strip.presence ] }
    end

    def render_validation_errors(product)
      render_error product.errors.full_messages.to_sentence, :unprocessable_content, details: product.errors.to_hash
    end
  end
end
