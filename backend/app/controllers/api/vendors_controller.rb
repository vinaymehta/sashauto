module Api
  # Vendors list (search, sort and pagination in PostgreSQL), CRUD and Excel import. Changes are admin-only.
  class VendorsController < ApplicationController
    SORTS = {
      "name" => "vendors.name", "product_count" => "product_count", "updated_at" => "vendors.updated_at"
    }.freeze

    before_action -> { require_role(:admin) }, except: %i[index show]
    rate_limit to: 20, within: 1.hour, only: :import, store: RATE_LIMIT_STORE, by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many imports in a short time. Try again later.", :too_many_requests }

    def index
      scope = Vendor.select("vendors.*", "(SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = vendors.id) AS product_count")
      if params[:q].present?
        term = "%#{Vendor.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        # Vendor name, or any of its parts (Part Number, SASH Part, Vendor Part).
        scope = scope.where(<<~SQL, t: term)
          vendors.name ILIKE :t OR EXISTS (
            SELECT 1 FROM vendor_products vp JOIN products p ON p.id = vp.product_id
            WHERE vp.vendor_id = vendors.id AND (p.part_number ILIKE :t OR vp.sash_part ILIKE :t OR vp.vendor_part ILIKE :t)
          )
        SQL
      end
      scope, sort, direction = apply_sort(scope, SORTS, default: "name")
      vendors, meta = paginate(scope)
      render json: { data: vendors.map { |v| Serializers.vendor(v) }, meta: meta.merge(sort: sort, direction: direction) }
    end

    def show
      render json: { data: Serializers.vendor(find_vendor) }
    end

    def create
      vendor = Vendor.new(name: params.require(:name), email: params[:email])
      if vendor.save
        audit("vendor.created", subject: vendor, name: vendor.name)
        render json: { data: Serializers.vendor(vendor, product_count: 0) }, status: :created
      else
        render_validation_errors(vendor)
      end
    rescue ActiveRecord::RecordNotUnique
      render_error "A vendor with this name already exists.", :unprocessable_content
    end

    def update
      vendor = Vendor.find(params[:id])
      before = vendor.name
      attrs = { name: params.require(:name) }
      attrs[:email] = params[:email] if params.key?(:email)
      if vendor.update(attrs)
        audit("vendor.updated", subject: vendor, name_before: before, name_after: vendor.name, email: vendor.email)
        render json: { data: Serializers.vendor(vendor) }
      else
        render_validation_errors(vendor)
      end
    rescue ActiveRecord::RecordNotUnique
      render_error "A vendor with this name already exists.", :unprocessable_content
    end

    # Deletes the vendor and its part list (the Products themselves stay).
    def destroy
      vendor = Vendor.find(params[:id])
      count = vendor.vendor_products.count
      vendor.destroy!
      audit("vendor.deleted", subject: vendor, name: vendor.name, products: count)
      head :no_content
    end

    def import
      file = params.require(:file)
      unless file.respond_to?(:path) && File.extname(file.original_filename.to_s).casecmp?(".xlsx")
        return render_error("Choose an .xlsx file.", :unprocessable_content, code: "invalid_file")
      end
      if file.size > AppConfig.max_upload_bytes
        return render_error("The file is larger than #{AppConfig.max_upload_bytes / 1.megabyte} MB.", :unprocessable_content, code: "invalid_file")
      end

      result = Vendors::Importer.call(path: file.path)
      audit("vendor.imported", filename: file.original_filename.to_s.first(255), **result.to_h.except(:skipped), skipped: result.skipped.size)
      render json: { data: result.to_h }
    rescue Vendors::Importer::InvalidFile => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    private

    def find_vendor
      Vendor.select("vendors.*", "(SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = vendors.id) AS product_count")
            .find(params[:id])
    end

    def render_validation_errors(record)
      render_error record.errors.full_messages.to_sentence, :unprocessable_content, details: record.errors.to_hash
    end
  end
end
