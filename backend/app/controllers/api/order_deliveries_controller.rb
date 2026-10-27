module Api
  # Status marks on an order row (OrderDelivery): an admin marks received / dispatched (with the SASH India invoice
  # number), the Warehouse Manager inbound / outbound. Only an admin removes a wrong mark. The Warehouse Manager's
  # marks email the admins (the India team); every mark shows in the admins' notification bell.
  class OrderDeliveriesController < ApplicationController
    def create
      row = params[:manual] == "1" ? ManualOrder.active.find(params[:order_id]) : OrderRow.find(params[:order_id])
      kind = params.require(:kind).to_s
      return render_error("Unknown status.", :unprocessable_content) unless OrderDelivery::KINDS.include?(kind)
      unless OrderDelivery::ROLE_KINDS.fetch(current_user.role, []).include?(kind)
        return render_error("You cannot set the status \"#{OrderDelivery::LABELS.fetch(kind)}\".", :forbidden)
      end
      invoice = params[:invoice_number].to_s.strip.first(64).presence
      if kind == "dispatched" && invoice.nil?
        return render_error("Enter the SASH India invoice number.", :unprocessable_content, details: { invoice_number: [ "can't be blank" ] })
      end

      delivered_on = params[:delivered_on].present? ? (Date.iso8601(params[:delivered_on].to_s) rescue nil) : Time.zone.today
      return render_error("Enter a valid delivery date.", :unprocessable_content, details: { delivered_on: [ "is invalid" ] }) unless delivered_on
      key = VendorOrderPlacement.order_key(row)
      return already_marked(kind) if OrderDelivery.active.exists?(order_key: key, kind: kind)
      # Statuses go in route order: received → dispatched → inbound → outbound.
      previous = OrderDelivery.previous_kind(kind)
      if previous && !OrderDelivery.active.exists?(order_key: key, kind: previous)
        return render_error("Set \"#{OrderDelivery::LABELS.fetch(previous)}\" first.", :unprocessable_content)
      end

      delivery = OrderDelivery.create!(
        order_key: VendorOrderPlacement.order_key(row), kind: kind,
        **(row.is_a?(ManualOrder) ? { manual_order: row } : { order_row: row }),
        po_number: row.po_number, po_line_number: row.po_line_number, part_number: row.part_number,
        order_type: row.order_type, ship_date: row.ship_date, delivered_on: delivered_on,
        note: params[:note].to_s.strip.first(500).presence, invoice_number: invoice, marked_by: current_user
      )
      audit("order.delivery_marked", subject: delivery, kind: kind, po_number: row.po_number, part_number: row.part_number)
      recipients = Notifications::Outbox.recipients
      if current_user.role == "warehouse_manager" && recipients.any?
        OrderDeliveryMailer.with(delivery: delivery, recipients: recipients).marked.deliver_later
      end
      render json: { data: Serializers.order_delivery(delivery) }, status: :created
    rescue ActiveRecord::RecordNotUnique
      already_marked(kind)
    end

    # SASH India's list of dispatched orders (.xlsx, Orders::DispatchImport): the matching orders are marked Dispatched
    # with their invoice numbers; the rows that could not be matched come back with the reason. Admins only (they set
    # Dispatched).
    def import
      unless OrderDelivery::ROLE_KINDS.fetch(current_user.role, []).include?("dispatched")
        return render_error("Only an admin can import the dispatched orders.", :forbidden)
      end
      file = params.require(:file)
      unless file.respond_to?(:path) && File.extname(file.original_filename.to_s).casecmp?(".xlsx")
        return render_error("Choose an .xlsx file.", :unprocessable_content, code: "invalid_file")
      end
      if file.size > AppConfig.max_upload_bytes
        return render_error("The file is larger than #{AppConfig.max_upload_bytes / 1.megabyte} MB.", :unprocessable_content, code: "invalid_file")
      end

      result = Orders::DispatchImport.call(path: file.path, user: current_user)
      audit("order.dispatched_list_imported", filename: file.original_filename.to_s.first(255), rows: result.rows,
                                              orders_marked: result.orders_marked, skipped: result.skipped.size)
      render json: { data: result.to_h }
    rescue Orders::DispatchImport::InvalidFile => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    def destroy
      delivery = OrderDelivery.active.find(params[:id])
      later = OrderDelivery::KINDS.drop(OrderDelivery::KINDS.index(delivery.kind) + 1)
      if OrderDelivery.active.exists?(order_key: delivery.order_key, kind: later)
        return render_error("Remove the later status first.", :unprocessable_content)
      end
      delivery.update!(removed_at: Time.current, removed_by: current_user)
      audit("order.delivery_removed", subject: delivery, kind: delivery.kind, po_number: delivery.po_number, part_number: delivery.part_number)
      head :no_content
    end

    private

    def already_marked(kind)
      render_error "This order is already marked \"#{OrderDelivery::LABELS.fetch(kind)}\".", :conflict
    end
  end
end
