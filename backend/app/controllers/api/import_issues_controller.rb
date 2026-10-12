module Api
  # Problems from vendor workbook imports (skipped rows, unreadable values), listed on the Import issues tab of
  # Products and Vendors. Admins can fix and add a row, dismiss an issue, or delete the part a row created.
  class ImportIssuesController < ApplicationController
    before_action -> { require_role(:admin) }, except: :index
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
