module Api
  # Purchase orders → Import issues: rows of uploaded vendor PO lists and Purchase Received files that were not
  # recorded (PurchaseIssue). As the Import issues of Products and Vendors: a row whose vendor was not found is given a
  # vendor (an existing one, or added with the file's name) and recorded; any issue can be dismissed, and a dismissed
  # one reopened. Reading needs Orders view, the rest Orders edit (any role: the client's users upload these files).
  class PurchaseIssuesController < ApplicationController
    before_action :load_open_issue, except: %i[index reopen]

    def index
      status = PurchaseIssue::STATUSES.include?(params[:status]) ? params[:status] : "open"
      scope = PurchaseIssue.where(business: businesses, status: status).includes(:resolved_by, vendor_po_import: :uploaded_by)
      if (q = params[:q].to_s.strip.first(100)).present?
        term = "%#{PurchaseIssue.sanitize_sql_like(q)}%"
        scope = scope.where("purchase_issues.reason ILIKE :t OR purchase_issues.row_data->>'part_number' ILIKE :t OR " \
                            "purchase_issues.row_data->>'vendor' ILIKE :t OR purchase_issues.row_data->>'vendor_po' ILIKE :t OR " \
                            "purchase_issues.row_data->>'invoice_number' ILIKE :t", t: term)
      end
      issues, meta = paginate(scope.order(created_at: :desc, excel_row: :asc, id: :asc))
      counts = PurchaseIssue.where(business: businesses).group(:status).count
      render json: { data: issues.map { |i| issue_json(i) }, meta: meta.merge(counts: PurchaseIssue::STATUSES.to_h { |s| [ s, counts[s].to_i ] }) }
    end

    # POST /api/purchase_issues/:id/link_vendor { vendor_id }: the row's vendor is this one; records the row.
    def link_vendor
      record_with(Vendor.find(params.require(:vendor_id)), "linked")
    end

    # POST /api/purchase_issues/:id/create_vendor: adds the row's vendor name as a new vendor and records the row.
    def create_vendor
      name = @issue.row_data["vendor"].to_s.squish.first(200)
      return render_error("The row has no vendor name.", :unprocessable_content) if name.empty?

      vendor = nil
      PurchaseIssue.transaction do
        vendor = Vendor.create!(name: name)
        reason = record_row(vendor)
        raise ActiveRecord::Rollback if reason

        @issue.close!("resolved", user: current_user, resolution: "vendor_created")
      end
      return render_error(@reason, :unprocessable_content) if @reason

      audit("purchase_issue.vendor_created", subject: @issue, vendor: name)
      render json: { data: issue_json(@issue.reload) }
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique => e
      render_error "#{name}: #{e.respond_to?(:record) ? e.record.errors.full_messages.to_sentence : 'a vendor with this name already exists'}", :unprocessable_content
    end

    def dismiss
      @issue.close!("dismissed", user: current_user)
      audit("purchase_issue.dismissed", subject: @issue)
      render json: { data: issue_json(@issue) }
    end

    # A dismissed issue back to open. Resolved ones stay closed: their row was recorded.
    def reopen
      issue = PurchaseIssue.where(status: "dismissed").find(params[:id])
      issue.reopen!
      audit("purchase_issue.reopened", subject: issue)
      render json: { data: issue_json(issue) }
    end

    private

    def record_with(vendor, resolution)
      reason = nil
      PurchaseIssue.transaction do
        reason = record_row(vendor)
        raise ActiveRecord::Rollback if reason

        @issue.close!("resolved", user: current_user, resolution: resolution)
      end
      return render_error("#{vendor.name}: #{reason}", :unprocessable_content) if reason

      audit("purchase_issue.vendor_#{resolution}", subject: @issue, vendor: vendor.name)
      render json: { data: issue_json(@issue.reload) }
    end

    # Records the issue's row with this vendor; returns why not, or nil (kept in @reason too).
    def record_row(vendor)
      @reason = if @issue.vendor_po_import.kind == "received"
        VendorOrders::ReceivedImport.new(nil, nil, @issue.business, current_user).receive_issue(@issue, vendor)
      else
        VendorOrders::FileImport.new(nil, nil, @issue.business, current_user).place_issue(@issue, vendor)
      end
    end

    def load_open_issue
      @issue = PurchaseIssue.open.where(business: businesses).find(params[:id])
    end

    def issue_json(issue)
      row = issue.row_data
      { id: issue.id, status: issue.status, kind: issue.vendor_po_import.kind, reason_kind: issue.reason_kind, reason: issue.reason,
        excel_row: issue.excel_row, business: issue.business, filename: issue.vendor_po_import.original_filename,
        uploaded_at: issue.vendor_po_import.created_at, uploaded_by: issue.vendor_po_import.uploaded_by&.name,
        part_number: row["part_number"], po_number: row["po_number"], vendor: row["vendor"], reference: row["vendor_po"] || row["invoice_number"],
        qty: row["issued"] || row["qty"], date: row["date"] || row["received_on"],
        resolution: issue.resolution, resolved_by: issue.resolved_by&.name, resolved_at: issue.resolved_at }
    end
  end
end
