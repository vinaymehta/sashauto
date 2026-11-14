module Api
  # Purchase orders page: every vendor PO of the view's businesses (generated here with Place order, or recorded from an
  # uploaded vendor PO list), uploading such a list (VendorOrders::FileImport) or a Purchase Received file
  # (VendorOrders::ReceivedImport), and overriding the rows of an upload that came again with other values. Reading
  # needs Orders view; uploading Orders edit (any role: the client's users upload these files too).
  class PurchaseOrdersController < ApplicationController
    # Vendor POs, newest first, with their order (PO, Part, Ship Date), Qty, where they came from, Order placed and
    # Goods received; `q` searches the PO number, vendor, PO and Part. Also the latest uploads of vendor PO lists.
    def index
      orders = VendorOrder.includes(:vendor, :order_placed_by, :goods_received_by, :receipts, vendor_order_placement: [ :upload_batch, :vendor_po_import ])
                          .joins(:vendor_order_placement).left_joins(vendor_order_placement: :upload_batch)
      orders = orders.where(upload_batches: { business: businesses }).or(orders.where(vendor_order_placements: { upload_batch_id: nil }))
      # The cards above the list: every vendor PO of the view, by where it came from and whether the goods arrived.
      counts = { total: orders.count, file: orders.where(source: "file").count, app: orders.where(source: "app").count,
                 awaiting: orders.where(goods_received_at: nil).count }
      if (q = params[:q].to_s.strip.first(100)).present?
        pattern = "%#{VendorOrder.sanitize_sql_like(q)}%"
        orders = orders.joins(:vendor).where("vendor_orders.number ILIKE :p OR vendors.name ILIKE :p OR vendor_order_placements.po_number ILIKE :p " \
                                             "OR vendor_order_placements.part_number ILIKE :p", p: pattern)
      end
      source = params[:source].to_s
      orders = orders.where(source: source) if VendorOrder::SOURCES.include?(source)
      received = params[:received].to_s
      orders = orders.where.not(goods_received_at: nil) if received == "yes"
      orders = orders.where(goods_received_at: nil) if received == "no"
      total = orders.count
      per_page = params[:per_page].to_i.positive? ? params[:per_page].to_i.clamp(1, 500) : 100
      page = [ params[:page].to_i, 1 ].max
      list = orders.order(Arel.sql("vendor_order_placements.placed_at DESC, vendor_orders.id DESC")).offset((page - 1) * per_page).limit(per_page)
      imports = VendorPoImport.includes(:uploaded_by).where(business: businesses).order(created_at: :desc).limit(100)
      @came = came_on(list)
      render json: {
        data: list.map { |o| row(o) },
        imports: imports.map { |i| import_json(i) }, counts: counts.merge(issues: PurchaseIssue.open.where(business: businesses).count),
        meta: { page: page, per_page: per_page, total: total, total_pages: (total.to_f / per_page).ceil,
                from: total.zero? ? 0 : ((page - 1) * per_page) + 1, to: [ page * per_page, total ].min }
      }
    end

    # Upload a vendor PO list (.xlsx) of the chosen business: records its vendor POs, skips (and lists) the rest.
    def import
      return render_error("Choose DTP or GMBH: a vendor PO list is for one business.", :unprocessable_content, code: "business_required") unless Business::KEYS.include?(current_business)

      file = params.require(:file)
      unless file.respond_to?(:path) && File.extname(file.original_filename.to_s).casecmp?(".xlsx")
        return render_error("Choose an .xlsx file.", :unprocessable_content, code: "invalid_file")
      end
      if file.size > AppConfig.max_upload_bytes
        return render_error("The file is larger than #{AppConfig.max_upload_bytes / 1.megabyte} MB.", :unprocessable_content, code: "invalid_file")
      end

      record = VendorOrders::FileImport.call(path: file.path, filename: file.original_filename, business: current_business, user: current_user)
      render json: { data: import_json(record) }, status: :created
    rescue VendorOrders::FileImport::InvalidFile => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    # Upload a Purchase Received file (.xlsx) of the chosen business: records what the vendors delivered against their
    # vendor POs (VendorOrders::ReceivedImport).
    def import_received
      return render_error("Choose DTP or GMBH: a Purchase Received file is for one business.", :unprocessable_content, code: "business_required") unless Business::KEYS.include?(current_business)

      file = params.require(:file)
      unless file.respond_to?(:path) && File.extname(file.original_filename.to_s).casecmp?(".xlsx")
        return render_error("Choose an .xlsx file.", :unprocessable_content, code: "invalid_file")
      end
      if file.size > AppConfig.max_upload_bytes
        return render_error("The file is larger than #{AppConfig.max_upload_bytes / 1.megabyte} MB.", :unprocessable_content, code: "invalid_file")
      end

      record = VendorOrders::ReceivedImport.call(path: file.path, filename: file.original_filename, business: current_business, user: current_user)
      render json: { data: import_json(record) }, status: :created
    rescue VendorOrders::ReceivedImport::InvalidFile => e
      render_error e.message, :unprocessable_content, code: "invalid_file"
    end

    # POST /api/purchase_orders/override { import_id, ids: [], keep: [] }: applies the chosen conflicts of an upload (rows
    # uploaded again with other values) and keeps the earlier values for the `keep` ones.
    def override
      record = VendorPoImport.where(business: businesses).find(params.require(:import_id))
      ids = Array(params[:ids]).map(&:to_i)
      keep = Array(params[:keep]).map(&:to_i)
      failed = []
      conflicts = record.conflicts.map do |c|
        next c unless c["status"] == "open"
        next c.merge("status" => "kept") if keep.include?(c["id"])
        next c unless ids.include?(c["id"])

        reason = if record.kind == "received"
          VendorOrders::ReceivedImport.new(nil, nil, record.business, current_user).override(c, record)
        else
          VendorOrders::FileImport.override(c)
        end
        next c.merge("status" => "overridden") unless reason

        failed << "row #{c['row']}: #{reason}"
        c
      end
      record.update!(conflicts: conflicts)
      audit("purchase_import.overridden", subject: record, overridden: ids.size - failed.size, kept: keep.size)
      return render_error(failed.join("; "), :unprocessable_content) if failed.any?

      render json: { data: import_json(record) }
    end

    private

    def row(order)
      placement = order.vendor_order_placement
      { id: order.id, number: order.number, source: order.source, vendor_name: order.vendor.name, qty: Serializers.qty(order.qty), unit: order.unit,
        po_number: placement.po_number, po_line_number: placement.po_line_number, part_number: placement.part_number,
        order_type: placement.order_type, ship_date: placement.ship_date, business: placement.upload_batch&.business,
        placed_at: placement.placed_at, filename: placement.vendor_po_import&.original_filename,
        order_placed_at: order.order_placed_at, order_placed_by: order.order_placed_by&.name,
        # The day SASH received the Deere order: its first upload as Firm / Order (the Orders page's Firm Date).
        order_date: @came[[ OrderRow.group_key(placement.po_number, placement.part_number, placement.order_type), placement.po_line_number, placement.ship_date ]],
        goods_received_at: order.goods_received_at, goods_received_by: order.goods_received_by&.name,
        received_qty: Serializers.qty(order.receipts.sum(&:qty)),
        receipts: order.receipts.map { |r| { id: r.id, received_on: r.received_on, invoice_number: r.invoice_number, qty: Serializers.qty(r.qty) } } }
    end

    # [group_key, PO Line, Ship Date] => the day the order first came in a completed upload, for the listed vendor POs.
    def came_on(orders)
      tuples = orders.map do |o|
        p = o.vendor_order_placement
        [ OrderRow.group_key(p.po_number, p.part_number, p.order_type), p.po_line_number, p.ship_date ]
      end.uniq
      return {} if tuples.empty?

      zone = Time.find_zone!(AppConfig.ageing_time_zone)
      OrderRow.joins(:upload_batch).where(upload_batches: { status: "completed" }, group_key: tuples.map(&:first).uniq)
              .group(:group_key, :po_line_number, :ship_date).minimum("upload_batches.completed_at")
              .transform_values { |at| at.in_time_zone(zone).to_date }
    end

    def import_json(record)
      { id: record.id, kind: record.kind, business: record.business, filename: record.original_filename, uploaded_by: record.uploaded_by&.name,
        uploaded_at: record.created_at, rows: record.rows_count, created: record.created_count, skipped: record.skipped,
        conflicts: record.conflicts }
    end
  end
end
