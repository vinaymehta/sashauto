module Api
  # Problems from vendor workbook imports (skipped rows, unreadable values), listed on the Import issues tab of
  # Products and Vendors. Admins can fix and add a row, dismiss an issue, or delete the part a row created. A row of the
  # vendor details / tax officer file that was not saved (kind "vendor_details") is linked to an existing vendor
  # (its details go onto that vendor) or added as a new vendor.
  class ImportIssuesController < ApplicationController
    before_action :load_open_issue, except: :index

    def index
      status = ImportIssue::STATUSES.include?(params[:status]) ? params[:status] : "open"
      scope = ImportIssue.where(status: status).includes(:imported_by, :resolved_by, :vendor_product, :product)
      if params[:q].present?
        term = "%#{ImportIssue.sanitize_sql_like(params[:q].to_s.strip.first(100))}%"
        scope = scope.where("import_issues.message ILIKE :t OR import_issues.filename ILIKE :t OR " \
                            "import_issues.row_data->>'part_number' ILIKE :t OR import_issues.row_data->>'vendor_name' ILIKE :t", t: term)
      end
      issues, meta = paginate(scope.order(created_at: :desc, excel_row: :asc, id: :asc))
      render json: { data: issues.map { |i| Serializers.import_issue(i) }, meta: meta.merge(open_count: ImportIssue.open.count) }
    end

    # Imports the corrected row (same rules as the workbook import). It must have no problems left.
    def resolve
      row = params.require(:row).permit(*Vendors::Importer::COLUMNS.keys).to_h.symbolize_keys
      result = nil
      ImportIssue.transaction do
        result = Vendors::Importer.import_row(row, user: current_user)
        raise ActiveRecord::Rollback if result.problems.any?

        @issue.update!(product: result.product, vendor_product: result.vendor_product, row_data: row.transform_values { |v| v.to_s.strip.presence })
        @issue.close!("resolved", user: current_user, resolution: "fixed")
      end
      if result.problems.any?
        details = result.problems.each_with_object({}) { |p, h| (h[p[:field] || "base"] ||= []) << p[:message] }
        return render_error(result.problems.map { |p| p[:message] }.join(" "), :unprocessable_content, details: details)
      end
      audit("import_issue.resolved", subject: @issue, part_number: result.product.part_number, vendor: result.vendor_product.vendor.name)
      render json: { data: Serializers.import_issue(@issue.reload) }
    end

    # POST /api/import_issues/:id/link_vendor  { vendor_id: } — the row is this vendor: its details go onto it.
    def link_vendor
      return render_error("This issue is not a vendor details row.", :unprocessable_content) unless @issue.kind == "vendor_details"

      vendor = Vendor.find(params.require(:vendor_id))
      save_vendor(vendor, "linked")
    end

    # POST /api/import_issues/:id/create_vendor — the row is a new vendor (vendor details file only).
    def create_vendor
      unless @issue.kind == "vendor_details" && @issue.row_data["source"] == "details"
        return render_error("Only a row of the vendor details file can be added as a vendor.", :unprocessable_content)
      end

      save_vendor(Vendor.new(name: @issue.row_data["vendor_name"].to_s.squish.first(200)), "created")
    end

    def dismiss
      @issue.close!("dismissed", user: current_user)
      audit("import_issue.dismissed", subject: @issue)
      render json: { data: Serializers.import_issue(@issue) }
    end

    # Deletes the vendor part the row created, and its product too when the import created it and nothing else
    # uses it (no other vendor parts, orders, alerts, placements or conflicts).
    def delete_part
      removed = []
      ImportIssue.transaction do
        if (item = @issue.vendor_product)
          item.destroy!
          removed << "vendor part"
        end
        product = @issue.product
        if product && product_unused?(product)
          product.destroy!
          removed << "product #{product.part_number}"
        end
        @issue.close!("resolved", user: current_user, resolution: "deleted")
      end
      audit("import_issue.part_deleted", subject: @issue, removed: removed)
      render json: { data: Serializers.import_issue(@issue.reload), removed: removed }
    end

    private

    # Applies the row's details to `vendor` (saving it) and closes the issue; validation problems are returned as is.
    def save_vendor(vendor, resolution)
      ImportIssue.transaction do
        vendor.update!(@issue.row_data["attributes"].to_h)
        @issue.close!("resolved", user: current_user, resolution: resolution)
      end
      audit("import_issue.vendor_#{resolution}", subject: @issue, vendor: vendor.name)
      render json: { data: Serializers.import_issue(@issue.reload), vendor: Serializers.vendor(vendor, product_count: 0) }
    rescue ActiveRecord::RecordInvalid => e
      render_error "#{vendor.name}: #{e.record.errors.full_messages.to_sentence}", :unprocessable_content
    rescue ActiveRecord::RecordNotUnique
      render_error "#{vendor.name}: another vendor already has this name or Vendor Code.", :unprocessable_content
    end

    def load_open_issue
      @issue = ImportIssue.open.find(params[:id])
    end

    def product_unused?(product)
      product.source == "manual" && product.vendor_products.none? &&
        !OrderRow.exists?(part_number: product.part_number) && !ManualOrder.active.exists?(part_number: product.part_number) &&
        !MoqAlert.exists?(product_id: product.id) && !VendorOrderPlacement.exists?(product_id: product.id) &&
        !ProductConflict.exists?(product_id: product.id)
    end
  end
end
