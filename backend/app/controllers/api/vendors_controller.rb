module Api
  # Vendors list (search, sort and pagination in PostgreSQL), add, edit and Excel import (vendors are not deleted).
  # Changes are admin-only.
  class VendorsController < ApplicationController
    # Details of a vendor (besides the name).
    DETAILS = %i[code vendor_type salutation first_name last_name company_name email phone mobile language address gst
                 gst_treatment place_of_supply pan tax_preference currency payment_terms lead_days gst_rate tax_officer_address
                 portal_enabled remarks].freeze

    SORTS = {
      "name" => "vendors.name", "product_count" => "product_count", "available_count" => "available_count",
      "updated_at" => "vendors.updated_at"
    }.freeze
    # Each vendor's number of parts, and of parts with an "Current Inventory" quantity (pieces it has now).
    COUNT_COLUMNS = [ "vendors.*", "(SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = vendors.id) AS product_count",
                      "(SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = vendors.id AND vp.available_qty > 0) AS available_count" ].freeze

    PRODUCT_COUNT = "(SELECT COUNT(*) FROM vendor_products vp WHERE vp.vendor_id = vendors.id)".freeze
    # List filters (each several values, any of them matches): value => SQL condition.
    FILTERS = {
      parts: { "none" => "#{PRODUCT_COUNT} = 0", "some" => "#{PRODUCT_COUNT} > 0" },
      available: {
        "yes" => "EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.vendor_id = vendors.id AND vp.available_qty > 0)",
        "no" => "NOT EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.vendor_id = vendors.id AND vp.available_qty > 0)"
      },
      missing: { "contact" => "vendors.phone IS NULL AND vendors.mobile IS NULL", "email" => "vendors.email IS NULL",
                 "gst" => "vendors.gst IS NULL", "place" => "vendors.place_of_supply IS NULL" },
      vendor_type: Vendor::TYPES.to_h { |t| [ t, Vendor.sanitize_sql([ "vendors.vendor_type = ?", t ]) ] }
    }.freeze

    before_action -> { require_role(:admin) }, except: %i[index show]
    rate_limit to: 20, within: 1.hour, only: :import, store: RATE_LIMIT_STORE, by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many imports in a short time. Try again later.", :too_many_requests }

    def index
      scope = Vendor.select(*COUNT_COLUMNS)
      if params[:q].present?
        term = "%#{Vendor.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        # Vendor name, or any of its parts (Part Number, SASH Part, Vendor Part).
        scope = scope.where(<<~SQL, t: term)
          vendors.name ILIKE :t OR vendors.code ILIKE :t OR vendors.company_name ILIKE :t OR EXISTS (
            SELECT 1 FROM vendor_products vp JOIN products p ON p.id = vp.product_id
            WHERE vp.vendor_id = vendors.id AND (p.part_number ILIKE :t OR vp.sash_part ILIKE :t OR vp.vendor_part ILIKE :t)
          )
        SQL
      end
      places = multi_param(:place_of_supply)
      scope = scope.where(place_of_supply: places) if places.any?
      FILTERS.each { |name, conditions| scope = where_any(scope, name, conditions) }
      scope, sort, direction = apply_sort(scope, SORTS, default: "name")
      vendors, meta = paginate(scope)
      render json: { data: vendors.map { |v| Serializers.vendor(v) }, meta: meta.merge(sort: sort, direction: direction),
                     facets: { places_of_supply: Vendor.where.not(place_of_supply: nil).distinct.order(:place_of_supply).pluck(:place_of_supply) } }
    end

    def show
      render json: { data: Serializers.vendor(find_vendor) }
    end

    def create
      vendor = Vendor.new(name: params.require(:name), **params.permit(*DETAILS).to_h.symbolize_keys)
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
      attrs = { name: params.require(:name), **params.permit(*DETAILS).to_h.symbolize_keys }
      if vendor.update(attrs)
        audit("vendor.updated", subject: vendor, name_before: before, name_after: vendor.name, email: vendor.email)
        render json: { data: Serializers.vendor(vendor) }
      else
        render_validation_errors(vendor)
      end
    rescue ActiveRecord::RecordNotUnique
      render_error "A vendor with this name already exists.", :unprocessable_content
    end

    def import
      file = params.require(:file)
      unless file.respond_to?(:path) && File.extname(file.original_filename.to_s).casecmp?(".xlsx")
        return render_error("Choose an .xlsx file.", :unprocessable_content, code: "invalid_file")
      end
      if file.size > AppConfig.max_upload_bytes
        return render_error("The file is larger than #{AppConfig.max_upload_bytes / 1.megabyte} MB.", :unprocessable_content, code: "invalid_file")
      end

      # The vendor details or tax officer file (Vendors::DetailsImporter); otherwise a DTP Details file.
      return import_details(file) if Vendors::DetailsImporter.handles?(file.path)

      result = Vendors::Importer.call(path: file.path, user: current_user, filename: file.original_filename)
      audit("vendor.imported", filename: file.original_filename.to_s.first(255), **result.to_h.except(:skipped), skipped: result.skipped.size)
      render json: { data: result.to_h }
    rescue Vendors::Importer::InvalidFile => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    private

    # Vendor details (Vendor Code, contact, GSTIN, Lead Days, …) or the jurisdictional tax officer addresses, from the
    # vendor master files (Vendors::DetailsImporter).
    def import_details(file)
      result = Vendors::DetailsImporter.call(path: file.path, user: current_user, filename: file.original_filename)
      audit("vendor.details_imported", filename: file.original_filename.to_s.first(255), **result.to_h)
      render json: { data: result.to_h }
    rescue Vendors::DetailsImporter::InvalidFile => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    def find_vendor
      Vendor.select(*COUNT_COLUMNS)
            .find(params[:id])
    end

    def render_validation_errors(record)
      render_error record.errors.full_messages.to_sentence, :unprocessable_content, details: record.errors.to_hash
    end
  end
end
