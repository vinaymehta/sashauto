module Orders
  # The figures of the order lines of the current order data, as the Orders list, the Product and PO summaries and the
  # Dashboard's Fulfilment count them (#summary_lines): Qty ordered, dispatched, delivered to Deere, open at Deere and
  # pending to dispatch per row, and each row's status (#invoice_info). Included in Api::OrdersController, and in
  # Orders::CurrentLines for the Dashboard and other services. The includer provides `businesses` (the view's) and
  # `current_view?` (the latest uploads with manual orders and kept rows, not one earlier upload).
  module LineFigures
    # The business of an imported row: its upload's.
    BUSINESS_SQL = "(SELECT ub.business FROM upload_batches ub WHERE ub.id = order_rows.upload_batch_id) AS business".freeze

    # Columns of order_rows that manual_orders has too (same names and types).
    SHARED_COLUMNS = %w[id group_key po_number part_number order_type ship_date po_line_number ship_to_location
                        commodity_type qty previous_qty effective_qty quantity_source due_date unit plant_code
                        last_asn_qty last_asn_date last_receipt_qty last_receipt_date last_packing_list_number
                        crossdock_location dock_number supplier_part_number last_released_date last_updated_date
                        source_data source_columns created_at].freeze

    # Statuses in route order: dispatch (part of the Qty dispatched on SASH India invoices) and dispatched (all of it, or a
    # Dispatched mark) come from Faridabad; delivery (part of the Qty delivered to Deere on SASH Inc invoices) and
    # outbound (all of it, or an Outbound mark) from SASH US.
    # Note of the Received mark the dispatched orders list sets (Orders::DispatchImport).
    LIST_RECEIVED_NOTE = "Set by the dispatched orders list".freeze
    STATUSES = %w[none received dispatch dispatched inbound delivery outbound].freeze

    # Businesses whose deliveries to Deere are not on SASH Inc invoices: Deere's receipts tell what arrived (and when, for
    # YTD: Dashboard::Money).
    RECEIPT_BUSINESSES = %w[gmbh].freeze
    # Businesses whose Delivered also follows Deere's receipts (Cumulative Receipt Qty, up to what was dispatched): DTP's
    # SASH Inc invoices can lag behind what Deere has already received, so a row's Delivered is the more of the two.
    RECEIPT_CHECKED = %w[dtp gmbh].freeze

    private

    # The uploads' rows, plus (current view) the manual orders and the kept rows (see #kept_rows), as one
    # `order_rows` relation so the search, filters, sorting and pagination below apply to all. Each row has
    # `manual` and `kept` (true/false).
    def dataset(batches)
      # The business of each upload is known here (BUSINESS_SQL would look it up for every row).
      business = batches.map { |b| "WHEN #{Integer(b.id)} THEN #{OrderRow.connection.quote(b.business)}" }.join(" ")
      imported = OrderRow.where(upload_batch_id: batches.map(&:id))
                         .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                                 "false AS manual", "false AS kept", batches.empty? ? BUSINESS_SQL : "(CASE order_rows.upload_batch_id #{business} END) AS business")
      return OrderRow.from("(#{imported.to_sql}) AS order_rows") unless current_view?

      manual = manual_orders.select(*SHARED_COLUMNS, "NULL::bigint AS upload_batch_id", "NULL::integer AS source_row_number",
                                    "true AS current", "1 AS group_row_count", "true AS manual", "false AS kept", "business")
      kept = OrderRow.where(id: kept_ids(batches))
                     .select(*SHARED_COLUMNS, :upload_batch_id, :source_row_number, :current, :group_row_count,
                             "false AS manual", "true AS kept", BUSINESS_SQL)
      OrderRow.from("(#{imported.to_sql} UNION ALL #{manual.to_sql} UNION ALL #{kept.to_sql}) AS order_rows")
    end

    # Active manual orders of the view's businesses.
    def manual_orders
      ManualOrder.active.where(business: businesses)
    end

    # Orders of the view's businesses placed with vendors, with an active status mark or on an uploaded invoice that are
    # no longer in their business's latest upload: like manual orders they stay on the Orders page. One row per order (PO + Part + Type +
    # PO Line + Ship Date), its last version.
    def kept_rows(batches)
      OrderRow.kept(batches.map(&:id), businesses)
    end

    # Ids of the kept rows (see #kept_rows), looked up once per request: the dataset is queried several times (page,
    # count, vendor facet).
    def kept_ids(batches)
      @kept_ids ||= {}
      @kept_ids[batches.map(&:id)] ||= kept_rows(batches).pluck(:id)
    end

    # The rows of the combined orders (Orders::Combiner): @anchor_of (row id => the combined order's first row) and
    # @combined_keys (row id => the combined order's placement key, its first row's: its PO, status and Firm Date are
    # recorded there).
    def load_combined_orders(combined)
      @anchor_of = {}
      @combined_keys = {}
      @combined_own = {}
      @combined_ship = {}
      combined.groups.each_value do |g|
        next unless g.combined?

        key = VendorOrderPlacement.order_key(g.members.find { |m| m.id == g.anchor_id })
        ships = g.members.map(&:ship_date).max # a combined order ships with its last order (as on the Dashboard)
        g.members.each do |m|
          @anchor_of[m.id] = g.anchor_id
          @combined_keys[m.id] = key
          @combined_own[m.id] = VendorOrderPlacement.order_key(m)
          @combined_ship[m.id] = ships
        end
      end
    end

    # Changes whenever anything the Fulfilment lines read changes: the latest uploads, status marks, invoices and their
    # allocations, manual orders, combined orders, products (descriptions, charges, customer prices) and settings.
    def lines_version(batches)
      stamps = [ OrderDelivery, Invoice, ManualOrder, OrderMerge, Product, AppSetting ].map { |model| model.maximum(:updated_at)&.to_f }
      [ batches.map(&:id), stamps, InvoiceAllocation.maximum(:id), InvoiceAllocation.count, OrderMerge.count, OrderDelivery.count ].flatten.join("-")
    end

    # Firm / Order rows of `rows` (a list of the shown order data) with what the Orders list shows for each: Qty ordered,
    # dispatched (invoices, the dispatched orders list or a Dispatched mark), delivered (SASH Inc invoices or Outbound;
    # GMBH: Deere's receipts, #receipts_delivered) and Deere's price under the price model of Admin Settings
    # (Orders::DeerePrices; per 100 pcs).
    def summary_lines(rows)
      deliveries = deliveries_by_key(rows)
      own_keys = rows.map { |row| own_key(row) }
      progress = Invoices::Progress.for_keys(own_keys)
      named = listed_marks(own_keys) # the list's mark naming each row (see #index)
      fallback = Product.where(part_number: rows.map(&:part_number).uniq).pluck(:part_number, :customer_price).to_h
      charges = Product.charge_parts(rows.map(&:part_number))
      receipts = deere_receipts
      # Deere's file can list one order line twice (same PO + Part + Type + PO Line + Ship Date, e.g. GMBH's 4500417775
      # under two Units): counted once, on the row with the most Qty (the first in the file when equal).
      repeats = rows.each_index.group_by { |i| [ rows[i].upload_batch_id, own_keys[i] ] }.values
                    .flat_map { |same| same - [ same.max_by { |i| [ rows[i].qty.to_d, -i ] } ] }.to_set
      rows.each_with_index.filter_map do |row, i|
        next if row.order_type == "Forecast" || repeats.include?(i)

        marks = deliveries.fetch(placement_key(row), {})
        # Without the receipts' status (#receipt_statuses come from these lines): a delivered status would count the row as
        # dispatched and delivered in full below; the receipts' own status is added after #receipts_delivered.
        info = invoice_info(row, progress[own_keys[i]], marks, named: named.dig(own_keys[i], "dispatched"), receipts: false)
        ordered = info[:order_qty].to_d
        # Without Qty on invoices or the list for the row, a status counts all of it as sent, unless the order's Dispatched
        # mark came from the dispatched orders list: it names what each row got, so a row of a combined order it does not
        # name (shown Dispatched with its combined order) has sent nothing yet.
        by_list = marks.dig("dispatched", :invoice_lines).present? || named.key?(own_keys[i])
        shipped = if info[:shipped_qty] then info[:shipped_qty].to_d
        elsif !by_list && %w[dispatched inbound delivery outbound].include?(info[:status]) then ordered
        else 0.to_d
        end
        delivered = if info[:outbound_qty] then info[:outbound_qty].to_d
        elsif info[:status] == "outbound" then ordered
        else 0.to_d
        end
        charge = charges.include?(row.part_number)
        # Ordered = what Deere has received + what Deere still lists as open (pending as per DTP). Deere's Qty is the
        # open Qty, so a row's Qty at dispatch overstates it once goods arrive, and a kept row (no longer in Deere's file)
        # has nothing open: its dispatches count, its Qty does not. A manual order is SASH's own: its Qty stays. A charge
        # (freight) already billed on SASH Inc invoices is not open, even while Deere's file still lists it.
        open = if row[:manual] then [ ordered - delivered, 0.to_d ].max
        elsif row[:kept] then 0.to_d
        elsif charge && billed_charge?(row) then 0.to_d
        else row.qty.to_d
        end
        # One price for every figure: Deere's price under the price model of Admin Settings (Orders::DeerePrices: its
        # latest price, or the price the order came with), else the row's own, else the product's customer price.
        price = deere_prices.price(business: row[:business], po_number: row.po_number, part_number: row.part_number,
                                   order_key: row[:manual] ? nil : own_keys[i], unit: row.source_data&.dig("Unit Price")) || fallback[row.part_number]
        # Prices are per 100 pieces; a charge's Unit Price is the charge itself (Product.charge_parts).
        price *= 100 if price && charge
        { row: row, open: open, shipped: shipped, delivered: delivered, price: price, status: info[:status], charge: charge,
          billed: charge && !row[:manual] && billed_charge?(row), order_qty_was: ordered, shipped_was: shipped, kept: row[:kept] ? true : false }
      end.then { |lines| receipts_delivered(lines, receipts) }.each do |l|
        l[:ordered] = l[:open] + l[:delivered]
      end.then { |lines| allocate_pending(lines) }.each do |l|
        # Deere's receipts' status by what the row keeps after #allocate_pending (as #receipt_statuses, so the Status
        # column and the status filter agree).
        l[:status] = further(l[:status], receipt_status(l))
        l[:qty_change] = qty_change(l)
        # A charge (freight) is billed by Deere, not dispatched by SASH: nothing of it is pending to dispatch.
        l[:pending] = 0.to_d if l[:charge]
      end
    end

    # Deere's prices under the price model of Admin Settings (Orders::DeerePrices), once per request.
    def deere_prices
      @deere_prices ||= Orders::DeerePrices.new
    end

    # Cumulative Receipt Qty by [business, PO, Part, PO Line] in Deere's latest files (one per business).
    def deere_receipts
      @deere_receipts ||= begin
        batches = UploadBatch.latest_for("all").to_h { |b| [ b.id, b.business ] }
        receipts = {}
        OrderRow.where(upload_batch_id: batches.keys).order(:upload_batch_id, :source_row_number)
                .pluck(:upload_batch_id, :po_number, :part_number, :po_line_number, Arel.sql("source_data->>'Cumulative Receipt Qty'"))
                .each do |batch, po, part, line, received|
          qty = received.to_s.delete(",").strip
          key = [ batches[batch], po, part, line ]
          # Every PO line in the file gets an entry (blank = nothing received), so only a line Deere dropped has none.
          receipts[key] = [ receipts[key] || 0.to_d, qty.match?(/\A\d+(\.\d+)?\z/) ? BigDecimal(qty) : 0.to_d ].max
        end
        receipts
      end
    end

    # Delivered of RECEIPT_CHECKED rows from Deere's Cumulative Receipt Qty of their PO line: shared over the line's
    # rows earliest ship date first, each up to what it was dispatched (an Outbound mark or invoice keeps its Qty when
    # more). A kept row whose PO line Deere no longer lists was received in full: its dispatched Qty is delivered.
    # Receipts beyond what SASH dispatched are not counted (Deere's own, to reconcile with Deere).
    def receipts_delivered(lines, receipts)
      lines.select { |l| RECEIPT_CHECKED.include?(l[:row][:business]) && !l[:row][:manual] && !l[:charge] }
           .group_by { |l| [ l[:row][:business], l[:row].po_number, l[:row].part_number, l[:row].po_line_number ] }.each do |key, group|
        received = receipts[key]
        group = group.sort_by { |l| l[:row].ship_date }
        if received.nil?
          group.each { |l| l[:delivered] = [ l[:delivered], l[:shipped] ].max if l[:row][:kept] }
          next
        end
        # What Deere received beyond what is already delivered on the line (invoices, Outbound marks) goes to the rows
        # sent but not yet delivered, earliest ship date first.
        extra = received - group.sum(0.to_d) { |l| l[:delivered] }
        group.each do |l|
          break unless extra.positive?

          add = [ l[:shipped] - l[:delivered], extra ].min
          next unless add.positive?

          l[:delivered] += add
          extra -= add
        end
      end
      lines
    end

    # Status of a summary line from Deere's receipts (RECEIPT_CHECKED, #receipts_delivered), nil when Deere has received
    # nothing of it: Partial outbound while Deere's latest file still lists Qty open on the row; Outbound once Deere has
    # received all that was dispatched for it (a row Deere dropped, or lists at Qty 0); else Partial outbound. A billed
    # charge is Outbound too (its status reaches the Orders list, the Dashboard and the cards the same way).
    def receipt_status(line)
      row = line[:row]
      # A charge (freight) billed on SASH Inc invoices: Outbound, as nothing of it is left to deliver (#billed_charge?).
      return "outbound" if line[:billed]
      return nil unless RECEIPT_CHECKED.include?(row[:business]) && !row[:manual] && !line[:charge] && line[:delivered].positive?
      return "delivery" if !row[:kept] && row.qty.to_d.positive?

      line[:delivered] >= line[:shipped] ? "outbound" : "delivery"
    end

    # Own order key => status from Deere's receipts (#receipt_status) of the rows of the current order data of the
    # RECEIPT_CHECKED businesses (Orders::CurrentLines), once per request.
    def receipt_statuses
      @receipt_statuses ||= Orders::CurrentLines.receipt_statuses
    end

    # The further of two statuses (nil: none).
    def further(*statuses)
      statuses.compact.max_by { |kind| STATUSES.index(kind) || 0 }
    end

    # Dispatched and Pending to dispatch (as per SASH) of each summary line. Dispatches are often recorded on an earlier
    # ship date than the Qty Deere now lists (Deere moves open Qty to a later ship date, e.g. 297 sent on a 21 Jul row
    # Deere now lists at 0, its Qty moved to 11 Dec), so within one PO line (PO + Part + PO Line) what a row got beyond
    # its Ordered moves to the open rows after it, earliest ship date first. Each row then shows Dispatched up to its
    # Ordered; what is left over (more sent than the PO line's Ordered) stays on the rows it was sent for. The PO line's
    # Dispatched is unchanged, and the rows' pending adds up to its Ordered − Dispatched.
    def allocate_pending(lines)
      lines.group_by { |l| [ l[:row].po_number, l[:row].part_number, l[:row].po_line_number ] }.each_value do |group|
        group = group.sort_by { |l| l[:row].ship_date }
        extra = group.map { |l| [ l[:shipped] - l[:ordered], 0.to_d ].max }
        surplus = extra.sum(0.to_d)
        group.each_with_index do |l, i|
          l[:shipped] -= extra[i]
          covered = [ l[:ordered] - l[:shipped], surplus ].min
          surplus -= covered
          l[:shipped] += covered
          l[:pending] = l[:ordered] - l[:shipped]
          # A row nothing was recorded against that now holds goods sent on an earlier ship date shows them in its status.
          if covered.positive? && [ nil, "none", "received" ].include?(l[:status])
            l[:status] = l[:pending].positive? ? "dispatch" : "dispatched"
          end
        end
        group.each_with_index do |l, i|
          back = [ extra[i], surplus ].min
          surplus -= back
          l[:shipped] += back
        end
      end
      lines
    end

    # Why a summary line's Ordered / Dispatched differ from the row's Order Qty / Shipped Qty on its invoices (nil: they
    # do not): { ordered: [was, now], dispatched: [was, now], causes: [...] }.
    def qty_change(l)
      ordered_changed = l[:ordered] != l[:order_qty_was]
      moved = l[:shipped] - l[:shipped_was]
      return nil unless ordered_changed || moved != 0

      causes = []
      if ordered_changed
        causes << if l[:kept]
          "Deere no longer lists this row, so only what Deere has received (#{Serializers.qty(l[:delivered])}) counts as ordered."
        else
          "Ordered = delivered to Deere (#{Serializers.qty(l[:delivered])}) + still open at Deere (#{Serializers.qty(l[:open])}); " \
            "the Order Qty at dispatch was #{Serializers.qty(l[:order_qty_was])}."
        end
      end
      causes << "Dispatched is capped at Ordered; #{Serializers.qty(-moved)} moved to the next open row of this PO line." if moved.negative?
      causes << "Got #{Serializers.qty(moved)} dispatched from another row of this PO line that had dispatched more than it ordered." if moved.positive?
      { ordered: [ Serializers.qty(l[:order_qty_was]), Serializers.qty(l[:ordered]) ],
        dispatched: [ Serializers.qty(l[:shipped_was]), Serializers.qty(l[:shipped]) ], causes: causes }
    end

    # A listed row's Qty columns from the uploaded invoices (Invoices::Progress `progress`, nil without any): Order Qty
    # (the Qty when dispatched, when higher than Deere's open Qty now), Shipped Qty (dispatched on SASH India invoices),
    # Balance Qty (still to send), Outbound Qty (delivered on SASH Inc invoices), each invoice move, and the status: the
    # further of its marks' (`marks`, kind => mark), its invoices' and (`receipts`) Deere's receipts' (#receipt_statuses).
    def invoice_info(row, progress, marks, named: nil, receipts: true)
      # A row of a combined order (its first row too) that no line of a dispatched orders list names, while the combined
      # order's Dispatched mark came from such a list: nothing of it has gone, so the marks from Dispatched on, and the
      # Received the list set, are the other rows' (e.g. 14 Dec under a combined order whose 26 Nov row was shipped).
      # As #mark_status_sql.
      if !row[:manual] && @combined_keys && not_sent_ids.include?(row.id)
        marks = marks.reject { |kind, d| %w[dispatched inbound outbound].include?(kind) || (kind == "received" && d[:note].to_s.start_with?(LIST_RECEIVED_NOTE)) }
      end
      mark = OrderDelivery::KINDS.reverse.find { |kind| marks.key?(kind) } || "none"
      from_invoices = progress&.status(row.qty)
      from_invoices = "delivery" if from_invoices == "outbound" && deere_open?(row)
      from_invoices = "outbound" if from_invoices == "delivery" && deere_closed?(row)
      status = further(mark, from_invoices, (receipt_statuses[VendorOrderPlacement.order_key(row)] if receipts && !row[:manual]))
      # Sent by the dispatched orders list: its Qty there counts as shipped, with its Qty on SASH India invoices (a list
      # line of an uploaded invoice is left out, #listed_qty). `named`: the list's Dispatched mark naming the row
      # (#listed_marks), else the order's own.
      listed = listed_qty(row, named || marks["dispatched"])
      if progress.nil? && listed.zero?
        return { status: status, order_qty: Serializers.qty(row.qty), shipped_qty: nil, balance_qty: Serializers.qty(row.qty), outbound_qty: nil, invoice_moves: [] }
      end

      shipped = (progress&.shipped || 0.to_d) + listed
      # At least what was sent: Deere's Qty drops as it receives (e.g. 4 open of 150 sent on the dispatched list).
      order_qty = [ progress ? progress.order_qty(row.qty) : row.qty.to_d, shipped ].max
      { status: status, order_qty: Serializers.qty(order_qty), shipped_qty: Serializers.qty(shipped),
        balance_qty: Serializers.qty([ order_qty - shipped, 0.to_d ].max), outbound_qty: progress&.outbound&.positive? ? Serializers.qty(progress.outbound) : nil,
        invoice_moves: (progress&.moves || []).map { |m| { kind: m.kind, invoice_id: m.invoice_id, invoice_number: m.invoice_number, invoice_date: m.invoice_date, qty: Serializers.qty(m.qty) } } }
    end

    # Whether a listed row is still open in Deere's latest file (Qty above 0; not a manual order nor a kept row): its
    # invoices cannot make it Outbound, Deere still waits for that Qty. A charge (freight) is not goods Deere receives:
    # once billed on SASH Inc invoices it is Outbound, even while Deere's file still lists it.
    def deere_open?(row)
      row.has_attribute?(:kept) && !row[:kept] && !row[:manual] && row.qty.to_d.positive? && !charge_part?(row.part_number)
    end

    # Whether a charge row (freight) is billed in full on SASH Inc invoices: their Qty on its PO + PO Line + Part (whatever
    # the Type or ship date it was matched to: Deere relists a billed charge, e.g. Firm as Order) covers its Qty.
    def billed_charge?(row)
      @billed_charges ||= InvoiceAllocation.active.where(invoices: { kind: "inc" }, manual_order_id: nil)
                                           .group(:po_number, :po_line_number, :part_number).sum(:qty)
      billed = @billed_charges[[ row.po_number, row.po_line_number, row.part_number ]].to_d
      billed.positive? && billed >= row.qty.to_d
    end

    # Whether a part is a charge (freight, Product.charge_parts), looked up once per request.
    def charge_part?(part_number)
      (@charge_part_numbers ||= Product.charge_parts(Product.distinct.pluck(:part_number))).include?(part_number)
    end

    # Whether a listed row is in Deere's latest file with Qty 0: what was delivered on it is all Deere wants there (its
    # other Qty moved to a later ship date), so its invoices make it Outbound, not Partial outbound.
    def deere_closed?(row)
      row.has_attribute?(:kept) && !row[:kept] && !row[:manual] && row.qty.to_d.zero?
    end

    # Order key => { "dispatched" => mark } of the Dispatched marks on these keys or naming them on their list lines.
    def listed_marks(keys)
      marks = OrderDelivery.active.where(kind: "dispatched")
                           .where("order_key IN (:keys) OR EXISTS (SELECT 1 FROM jsonb_array_elements(invoice_lines) l WHERE l->>'order_key' IN (:keys))", keys: keys)
      marks.each_with_object({}) do |d, by_key|
        mark = { "dispatched" => { invoice_lines: d.invoice_lines } }
        by_key[d.order_key] ||= mark if keys.include?(d.order_key)
        d.invoice_lines.each { |line| by_key[line["order_key"]] ||= mark if keys.include?(line["order_key"]) }
      end
    end

    # Qty of a row sent on a Dispatched mark (`mark`, serialized): its lines on the dispatched orders list (their Qty, the
    # row's Qty when a line has none), or all of it when the mark names no lines (marked by hand).
    def listed_qty(row, mark)
      return 0.to_d unless mark

      lines = Array(mark[:invoice_lines])
      return row.qty.to_d if lines.empty?

      own = row[:manual] ? VendorOrderPlacement.order_key(ManualOrder.new(id: row.id)) : VendorOrderPlacement.order_key(row)
      lines.select { |line| line["order_key"] == own && !india_numbers.include?(line["invoice"]) }
           .sum(0.to_d) { |line| line["qty"].present? ? BigDecimal(line["qty"].to_s) : row.qty.to_d }
    end

    # Numbers of the uploaded SASH India invoices (Invoice.india_numbers), once per request.
    def india_numbers
      @india_numbers ||= Invoice.india_numbers
    end

    # Active inbound / outbound delivery marks of the listed rows: { key => { "inbound" => {...}, "outbound" => {...} } }.
    def deliveries_by_key(rows)
      OrderDelivery.active.includes(:marked_by).where(order_key: rows.map { |row| placement_key(row) })
                   .group_by(&:order_key)
                   .transform_values { |list| list.to_h { |d| [ d.kind, Serializers.order_delivery(d) ] } }
    end

    # Placement key of a listed row (an imported row, or a manual order listed with `manual`): the combined order's (its
    # first row's) for the rows of a combined order.
    def placement_key(row)
      return VendorOrderPlacement.order_key(ManualOrder.new(id: row.id)) if row[:manual]

      @combined_keys&.dig(row.id) || VendorOrderPlacement.order_key(row)
    end

    # A listed row's own order key (not its combined order's): the key its invoices are recorded on.
    def own_key(row)
      row[:manual] ? placement_key(row) : VendorOrderPlacement.order_key(row)
    end

    # Rows of combined orders (#load_combined_orders) whose combined order was marked Dispatched by a dispatched orders
    # list that names other rows, while no list line names them: nothing of them has gone. Looked up once per request.
    def not_sent_ids
      @not_sent_ids ||= begin
        marks = OrderDelivery.active.where(kind: "dispatched").where.not(invoice_lines: nil).pluck(:order_key, :invoice_lines)
        listed = marks.select { |_, lines| Array(lines).any? }.map(&:first).to_set
        named = marks.flat_map { |_, lines| Array(lines).map { |l| l["order_key"] } }.to_set
        @combined_keys.select { |id, key| listed.include?(key) && !named.include?(@combined_own[id]) }.keys
      end
    end
  end
end
