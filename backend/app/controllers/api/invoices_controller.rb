module Api
  # SASH invoices uploaded on the Orders page (Actions → Upload SASH India invoice / Upload SASH Inc invoice, .pdf or
  # .xlsx, Invoices::Import): `preview` reads the file and shows which order rows its lines go to, `create` saves it
  # (SASH India: dispatched Qty; SASH Inc: outbound Qty). An admin uploads and removes both; the Warehouse Manager only
  # SASH Inc invoices (delivered to Deere, as the Outbound mark is theirs). Anyone with view of the Orders downloads an
  # invoice's file.
  class InvoicesController < ApplicationController
    EXTENSIONS = %w[.pdf .xlsx].freeze

    before_action :require_uploader, except: :download

    def preview
      return unless (file = upload)

      render json: { data: import(file).preview }
    rescue Invoices::Import::Rejected => e
      render_error e.message, :unprocessable_content, code: "invalid_invoice"
    end

    def create
      return unless (file = upload)

      invoice, summary = import(file).save
      audit("invoice.saved", subject: invoice, kind: invoice.kind, invoice_number: invoice.invoice_number)
      render json: { data: summary }, status: :created
    rescue Invoices::Import::Rejected => e
      render_error e.message, :unprocessable_content, code: "invalid_invoice"
    end

    # Removes an invoice (kept with who/when): its dispatched or outbound Qty goes back. A SASH India invoice whose Qty
    # was delivered on a SASH Inc invoice is removed after that one.
    def destroy
      invoice = Invoice.active.find(params[:id])
      return render_error("Only an admin can remove a SASH India invoice.", :forbidden) if inc_only? && invoice.kind != "inc"
      if invoice.kind == "india" && (blocking = later_inc_invoices(invoice)).any?
        return render_error("Remove SASH Inc invoice #{blocking.join(', ')} first: it delivered Qty this invoice dispatched.", :unprocessable_content)
      end

      invoice.update!(removed_at: Time.current, removed_by: current_user)
      audit("invoice.removed", subject: invoice, kind: invoice.kind, invoice_number: invoice.invoice_number)
      head :no_content
    end

    def download
      invoice = Invoice.find(params[:id])
      return render_error("The invoice file is not stored.", :not_found) unless invoice.file.attached?

      # `inline`: shown in the browser (Preview, a PDF) instead of saved.
      send_data invoice.file.download, filename: invoice.original_filename, type: invoice.file.content_type,
                                       disposition: params[:inline] == "1" ? "inline" : "attachment"
    end

    private

    def require_uploader
      render_error "Only an admin or the Warehouse Manager can upload or remove invoices.", :forbidden unless current_user.admin? || inc_only?
    end

    # The Warehouse Manager uploads and removes SASH Inc invoices only.
    def inc_only?
      current_user.role == "warehouse_manager"
    end

    # The uploaded file (.pdf / .xlsx, within the upload size), or nil after rendering the error.
    def upload
      file = params.require(:file)
      error = if !file.respond_to?(:path) || !EXTENSIONS.include?(File.extname(file.original_filename.to_s).downcase)
        "Choose a .pdf or .xlsx invoice."
      elsif file.size > AppConfig.max_upload_bytes
        "The file is larger than #{AppConfig.max_upload_bytes / 1.megabyte} MB."
      end
      return file unless error

      render_error error, :unprocessable_content, code: "invalid_file"
      nil
    end

    def import(file)
      # One upload for both invoices: without `kind` the file says which it is (its Exporter).
      kind = params[:kind].presence
      raise Invoices::Import::Rejected, "Unknown invoice kind." if kind && !Invoice::KINDS.include?(kind.to_s)
      if inc_only?
        raise Invoices::Import::Rejected, "Only an admin can upload a SASH India invoice." if kind && kind != "inc"
        kind = "inc" # a SASH India file is then refused by the import (it is not a SASH Inc invoice)
      end
      Invoices::Import.new(path: file.path, filename: file.original_filename, kind: kind, view: current_business, user: current_user)
    end

    # Numbers of the active SASH Inc invoices that delivered more of this invoice's orders than the other SASH India
    # invoices dispatched.
    def later_inc_invoices(invoice)
      keys = invoice.allocations.pluck(:order_key).uniq
      progress = Invoices::Progress.for_keys(keys)
      own = invoice.allocations.reorder(nil).group(:order_key).sum(:qty)
      short = keys.select { |key| progress[key] && progress[key].outbound > progress[key].shipped - own[key].to_d }
      return [] if short.empty?

      Invoice.active.where(kind: "inc", id: InvoiceAllocation.where(order_key: short).select(:invoice_id)).order(:invoice_date).pluck(:invoice_number)
    end
  end
end
