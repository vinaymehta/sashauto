module Orders
  # Imports SASH India's dispatched orders: the "List of Dispatched Orders" (one row per shipment: SASH PART, Qty,
  # POnumber, Invoice Number, Invoice Date and SHIP DATE REQD or Due Date) or "Book 38" (one row per order: Part, Calc
  # Sales Order No, SHIP DATE REQD, Quantity, Shipped and up to 21 shipments of Invoice No + Qty; each shipment is a
  # row here, orders with nothing shipped are left out). Each row whose order is in the current order data (the
  # latest upload of each business) is marked "Dispatched from SASH Faridabad" with its invoice number and date, and
  # "Received at SASH Faridabad" first when it has no such mark yet (statuses go in route order). Book 38 has no
  # invoice date: the date of that SASH India invoice when it was uploaded (Invoices), else the import day.
  #
  # A row matches the Firm / Order order with its PO Number + Part Number whose Ship Date or Due Date is the row's date
  # (those with a Qty, then the same Qty, while that leaves several). With none on that date in the current order data,
  # the delivery may be one Deere has received and dropped from its file since: the order on that date in an earlier
  # upload (its last version), kept on Orders by its mark like other orders no longer in the file. Only then the one
  # Firm / Order order of the PO + Part with the row's Qty that Deere had already sent when the shipment was invoiced
  # (Deere sometimes moves the date). When the file's PO has no such order (SASH India's files sometimes name another
  # PO), the PO is taken from the order data: the order of the Part Number on the row's date, as above, under any PO
  # (listed in po_corrected). A row of a combined order marks the combined order (Orders::Combiner), as the Orders page
  # does. Rows of the same order (sent on several invoices) give one mark
  # with all their invoice numbers; importing the list again adds the invoices such a mark does not have yet. Rows that
  # match nothing, or several orders, and orders already dispatched otherwise are skipped and listed with the reason,
  # to be marked by hand.
  #
  #   Orders::DispatchImport.call(path:, user:)   # => Result
  class DispatchImport
    class InvalidFile < StandardError; end

    # po_corrected: rows matched under another PO than the file's ({ row:, part_number:, file_po:, po_number:, ... }).
    Result = Data.define(:rows, :orders_marked, :rows_marked, :skipped, :po_corrected)

    # Field => accepted headers (compared without case, spaces and punctuation).
    COLUMNS = {
      part_number: [ "SASH PART", "Part Number" ], qty: [ "Qty" ], po_number: [ "POnumber", "PO Number" ],
      invoice_number: [ "Invoice Number" ], invoice_date: [ "Invoice Date" ],
      date: [ "SHIP DATE REQD", "Ship Date", "Due Date" ]
    }.freeze
    REQUIRED = %i[part_number po_number invoice_number invoice_date date].freeze
    # Book 38: field => header, and the header of each shipment's invoice number (followed by its Qty column).
    BOOK_COLUMNS = { part_number: "Part", po_number: "Calc Sales Order No", date: "SHIP DATE REQD", shipped: "Shipped" }.freeze
    BOOK_INVOICE = "Invoice No"
    # Start of the note of the Dispatched marks it makes (followed by each row's invoice, date and Qty).
    NOTE = "From the dispatched orders list: ".freeze
    HEADER_SEARCH_ROWS = 20
    MAX_ROWS = 20_000

    def self.call(path:, user:)
      new(path, user).call
    end

    def initialize(path, user)
      @path = path
      @user = user
    end

    def call
      rows = read_rows
      skipped = []
      corrected = []
      orders = {} # anchor row id => [anchor row, [file rows]]
      combined = Combiner.for_batches(batch_ids)
      anchor_of = combined.groups.values.select(&:combined?).flat_map { |g| g.members.map { |m| [ m.id, g.anchor_id ] } }.to_h

      rows.each do |row|
        next skipped << skip(row, row[:problem]) if row[:problem]

        match = find_order(row)
        next skipped << skip(row, match) if match.is_a?(String)

        if match.po_number != row[:po_number]
          corrected << skip(row, nil).except(:reason).merge(file_po: row[:po_number], po_number: match.po_number)
          row[:po_number] = match.po_number
        end

        row[:order_key] = VendorOrderPlacement.order_key(match) # the order row it was sent for (shown on that row)
        anchor_id = anchor_of.fetch(match.id, match.id)
        (orders[anchor_id] ||= [ anchor_id == match.id ? match : OrderRow.find(anchor_id), [] ])[1] << row
      end

      marked = 0
      rows_marked = 0
      OrderDelivery.transaction do
        orders.each_value do |order, file_rows|
          problem = mark(order, file_rows)
          next file_rows.each { |row| skipped << skip(row, problem) } if problem

          marked += 1
          rows_marked += file_rows.size
        end
      end
      Result.new(rows: rows.size, orders_marked: marked, rows_marked: rows_marked, skipped: skipped.sort_by { |s| s[:row] },
                 po_corrected: corrected.sort_by { |c| c[:row] })
    end

    private

    def batch_ids
      @batch_ids ||= UploadBatch.latest_for("all").map(&:id)
    end

    # The order of a file row, or why there is none (a message): under the file's PO + Part, else (that PO has no order
    # of the Part on the row's date or with its Qty, or is not in the order data) the Part's order on the row's date
    # under any PO of the order data (the PO in our latest pull).
    def find_order(row)
      lines = OrderRow.where(upload_batch_id: batch_ids, po_number: row[:po_number], part_number: row[:part_number])
      if lines.exists?
        found = on_date(lines, row, "this PO + Part")
        return found unless found.nil?
      end
      found = on_date(dropped(po_number: row[:po_number], part_number: row[:part_number]), row, "this PO + Part in earlier order files")
      return moved_to(found) unless found.nil?

      if lines.exists?
        found = same_qty_order(lines, row)
        return found unless found.is_a?(Symbol)
      end

      part_lines = OrderRow.where(upload_batch_id: batch_ids, part_number: row[:part_number])
      found = part_lines.exists? ? on_date(part_lines, row, "this Part") : nil
      found = moved_to(on_date(dropped(part_number: row[:part_number]), row, "this Part in earlier order files")) if found.nil?
      return found unless found.nil?
      return "Part #{row[:part_number]} is not in the current order data" unless part_lines.exists?

      if lines.exists?
        on = row[:date].strftime("%d %b %Y")
        forecast = lines.where(order_type: "Forecast").where(ship_date: row[:date]).or(lines.where(order_type: "Forecast").where(due_date: row[:date])).exists?
        "no Firm / Order of this PO + Part is on #{on} or has its Qty, and no other PO of the Part is on that date " \
          "(#{forecast ? 'only a Forecast line is on that date, and a Forecast is not an order' : "the delivery is no longer in Deere's file"})"
      else
        "PO #{row[:po_number]} + Part #{row[:part_number]} is not in the current order data, and no order of the Part is on " \
          "#{row[:date].strftime('%d %b %Y')}"
      end
    end

    # The one Firm / Order order of `lines` on the row's date (Ship Date or Due Date), a message when there are several,
    # nil when none. A Forecast line is not an order: nothing is dispatched for it, so it is never marked.
    def on_date(lines, row, what)
      found = lines.where.not(order_type: "Forecast").where(ship_date: row[:date]).or(lines.where.not(order_type: "Forecast").where(due_date: row[:date])).to_a
      return nil if found.empty?

      # Deere's file can list the same order line twice, once without a Qty (nothing required): the one with a Qty.
      with_qty = found.select { |line| line.qty.to_d.positive? }
      found = with_qty if with_qty.any?
      same_qty = found.select { |line| row[:qty] && line.qty == row[:qty] }
      found = same_qty if found.size > 1 && same_qty.any?
      # Several POs of the Part on that date: the file's PO among them.
      own_po = found.select { |line| line.po_number == row[:po_number] }
      found = own_po if found.size > 1 && own_po.any?
      found = distinct_orders(found)
      return found.first if found.one?

      "#{found.size} orders of #{what} are on #{row[:date].strftime('%d %b %Y')} " \
        "(#{found.map { |line| "PO #{line.po_number} Line #{line.po_line_number}" }.join(', ')})"
    end

    # No order on the list's date (its date is not always Deere's, e.g. GMBH's Due Date moved): the one Firm / Order
    # order of this PO + Part with the same Qty that was in Deere's file by the shipment's invoice date. Only with the
    # same Qty: an order of the PO + Part on another date with another Qty is a later delivery, not the one dispatched;
    # and an order Deere sent only after the invoice is a later one with the same Qty, not this shipment's (Deere drops
    # a delivery from its file once received). :none when there is none.
    def same_qty_order(lines, row)
      on = row[:date].strftime("%d %b %Y")
      same = distinct_orders(lines.where.not(order_type: "Forecast").where(qty: row[:qty]).to_a) if row[:qty]&.positive?
      same = same.select { |line| came_by?(line, row[:invoice_date]) } if same
      return same.first if same&.one?
      return "#{same.size} orders of this PO + Part have Qty #{row[:qty].to_s('F').sub(/\.0\z/, '')} and none is on #{on}" if same&.many?

      :none
    end

    # Whether Deere's file had the order (its PO + Part + Type + PO Line + Ship Date) on `date` or before.
    def came_by?(line, date)
      first = OrderRow.joins(:upload_batch).where(upload_batches: { status: "completed" }, group_key: line.group_key,
                                                  po_line_number: line.po_line_number, ship_date: line.ship_date)
                      .minimum("upload_batches.completed_at")
      first.nil? || first.in_time_zone(AppConfig.ageing_time_zone).to_date <= date
    end

    # Where a delivery no longer in Deere's file went, when Deere moved it rather than receiving it: the order of the same
    # PO + Part + PO Line that is new in the next upload after its last one, with the Qty it still had in that last one
    # (e.g. 19 Nov pulled in to 13 Sep: the list still names 19 Nov). Followed while it moves again; the current order,
    # else its last version. A delivery that ends with no Qty left (received) stays itself, even when a new one with
    # the same Qty follows. Anything else (a message, nil) is returned as it is.
    def moved_to(order, depth = 0)
      return order unless order.is_a?(OrderRow) && depth < 5

      business = order.upload_batch.business
      same = OrderRow.where(po_number: order.po_number, part_number: order.part_number, po_line_number: order.po_line_number)
                     .where.not(order_type: "Forecast")
      last = same.where(ship_date: order.ship_date).joins(:upload_batch).where(upload_batches: { business: business, status: "completed" })
                 .maximum(:upload_batch_id)
      following = UploadBatch.completed.where(business: business).where("id > ?", last).order(:id).first
      return order unless following

      final = same.where(upload_batch_id: last, ship_date: order.ship_date).maximum(:qty)
      return order unless final&.positive?

      before = same.where(upload_batch_id: last).pluck(:ship_date).to_set
      new_rows = same.where(upload_batch_id: following.id, qty: final).reject { |r| before.include?(r.ship_date) }
      return order unless new_rows.one?

      target = new_rows.first
      current = OrderRow.where(upload_batch_id: batch_ids, group_key: target.group_key, po_line_number: target.po_line_number,
                               ship_date: target.ship_date).first
      return current if current

      later = dropped(po_number: target.po_number, part_number: target.part_number).find_by(po_line_number: target.po_line_number, ship_date: target.ship_date)
      later ? moved_to(later, depth + 1) : order
    end

    # Orders no longer in the current order data (OrderRow.dropped).
    def dropped(**conditions)
      OrderRow.dropped(batch_ids, **conditions)
    end

    # Order lines that are the same order (Deere's file can list an order line twice) once.
    def distinct_orders(lines)
      lines.uniq { |line| VendorOrderPlacement.order_key(line) }
    end

    # Marks the order Received (when not yet) and Dispatched with the rows' invoices; adds them to a Dispatched mark this
    # list made before (an order sent on several invoices, matched on a later import). Returns why not, or nil.
    def mark(order, file_rows)
      key = VendorOrderPlacement.order_key(order)
      marks = OrderDelivery.active.where(order_key: key).index_by(&:kind)
      if (dispatched = marks["dispatched"])
        return "the order is already dispatched (invoice #{dispatched.invoice_number})" unless dispatched.note.to_s.start_with?(NOTE)

        return add_invoices(dispatched, file_rows)
      end

      later = (OrderDelivery::KINDS - %w[received dispatched]).find { |kind| marks.key?(kind) }
      return "the order is already marked \"#{OrderDelivery::LABELS.fetch(later)}\"" if later

      dates = file_rows.map { |row| row[:invoice_date] }
      create(order, key, "received", dates.min, nil, "Set by the dispatched orders list") unless marks.key?("received")
      delivery = create(order, key, "dispatched", dates.max, invoice_text(file_rows.map { |row| row[:invoice_number] }),
                        (NOTE + file_rows.map { |row| entry(row) }.join(", ")).first(500))
      delivery.update!(invoice_lines: merge_lines([], file_rows))
      AuditLog.record("order.delivery_marked", subject: delivery, user: @user, kind: "dispatched", po_number: order.po_number,
                                               part_number: order.part_number, source: "dispatched_list")
      nil
    end

    # Adds the rows' invoices to the mark: the ones it does not list yet (its date: the latest invoice date), and the
    # order row each was sent for (invoice_lines; also for a mark made before they were recorded).
    def add_invoices(delivery, file_rows)
      lines = merge_lines(delivery.invoice_lines, file_rows)
      listed = delivery.note.delete_prefix(NOTE).scan(/(?:\A|\), )([^()]+?) \(/).flatten
      added = file_rows.reject { |row| listed.include?(row[:invoice_number]) }.uniq { |row| row[:invoice_number] }
      return "the order is already marked Dispatched with this invoice" if added.empty? && lines == delivery.invoice_lines

      changes = { invoice_lines: lines }
      if added.any?
        changes.merge!(invoice_number: invoice_text(listed + added.map { |row| row[:invoice_number] }),
                       note: "#{delivery.note}, #{added.map { |row| entry(row) }.join(', ')}".first(500),
                       delivered_on: [ delivery.delivered_on, *added.map { |row| row[:invoice_date] } ].max)
      end
      delivery.update!(changes)
      if added.any?
        AuditLog.record("order.delivery_invoices_added", subject: delivery, user: @user, invoices: added.map { |row| row[:invoice_number] },
                                                         source: "dispatched_list")
      end
      nil
    end

    # `lines` plus the rows' shipments not among them yet. A shipment is the same one by its invoice, Qty and order row,
    # whatever its date: a list without invoice dates (Book 38) dates them the import day, so importing it again, or
    # after the old list, must not count a shipment twice. The line already there keeps its date.
    def merge_lines(lines, file_rows)
      merged = lines.dup
      # A list can name the same shipment twice for an order (same invoice and Qty, two packings): as many as it names.
      file_rows.map { |row| line(row) }.group_by { |l| l.values_at("invoice", "qty", "order_key") }.each_value do |same|
        merged.concat(same.drop(merged.count { |l| same_shipment?(l, same.first) }))
      end
      merged
    end

    def same_shipment?(a, b)
      a.values_at("invoice", "qty", "order_key") == b.values_at("invoice", "qty", "order_key")
    end

    # An invoice of the mark with the order row it was sent for (OrderDelivery#invoice_lines).
    def line(row)
      { "invoice" => row[:invoice_number], "date" => row[:invoice_date].iso8601, "qty" => row[:qty]&.to_s("F")&.sub(/\.0\z/, ""),
        "order_key" => row[:order_key] }
    end

    # "EX/25-26/328 (20.02.2026, Qty 1400)": a row in the mark's note.
    def entry(row)
      "#{row[:invoice_number]} (#{row[:invoice_date].strftime('%d.%m.%Y')}#{", Qty #{row[:qty].to_s('F').sub(/\.0\z/, '')}" if row[:qty]})"
    end

    # The invoice numbers for the mark (64 characters at most: the first one and how many more).
    def invoice_text(invoices)
      invoices = invoices.uniq
      text = invoices.join(", ")
      (text.length > 64 ? "#{invoices.first} +#{invoices.size - 1} more" : text).first(64)
    end

    def create(order, key, kind, on, invoice, note)
      OrderDelivery.create!(order_key: key, kind: kind, order_row: order, po_number: order.po_number, po_line_number: order.po_line_number,
                            part_number: order.part_number, order_type: order.order_type, ship_date: order.ship_date,
                            delivered_on: on, invoice_number: invoice, note: note, marked_by: @user)
    end

    def skip(row, reason)
      { row: row[:row], po_number: row[:po_number], part_number: row[:part_number], invoice_number: row[:invoice_number],
        date: row[:date], reason: reason }
    end

    # The file's data rows: { row:, part_number:, po_number:, qty:, invoice_number:, invoice_date:, date:, problem: }.
    def read_rows
      sheet = Roo::Excelx.new(@path.to_s, extension: :xlsx, file_warning: :ignore).sheet(0)
      raise InvalidFile, "The workbook is empty." unless sheet.first_row

      search = sheet.first_row..[ sheet.last_row, sheet.first_row + HEADER_SEARCH_ROWS ].min
      header_row = search.find { |n| header_index(sheet.row(n)) }
      unless header_row
        book_row = search.find { |n| book_index(sheet.row(n)) }
        return book_rows(sheet, book_row) if book_row

        raise InvalidFile, "Could not find the header row. Expected the List of Dispatched Orders (SASH PART, POnumber, Invoice Number, " \
                           "Invoice Date, SHIP DATE REQD or Due Date) or Book 38 (Part, Calc Sales Order No, SHIP DATE REQD, Invoice No, Qty)."
      end

      index = header_index(sheet.row(header_row))
      ((header_row + 1)..sheet.last_row).filter_map do |number|
        cells = sheet.row(number)
        next if cells.all? { |c| OrderRows::Normalizer.text(c).nil? }
        raise InvalidFile, "The file has more than #{MAX_ROWS} rows." if number - header_row > MAX_ROWS

        read_row(number, index.transform_values { |i| cells[i] })
      end
    rescue Zip::Error, ArgumentError, Roo::Error => e
      raise InvalidFile, "The file could not be read as an .xlsx workbook (#{e.class.name.demodulize})."
    end

    def read_row(number, cells)
      row = { row: number, part_number: OrderRows::Normalizer.part_number(cells[:part_number]),
              po_number: OrderRows::Normalizer.identifier(cells[:po_number]),
              invoice_number: OrderRows::Normalizer.text(cells[:invoice_number])&.first(64) }
      row[:qty] = (OrderRows::Normalizer.quantity(cells[:qty]) rescue nil)
      row[:invoice_date] = date(cells[:invoice_date])
      row[:date] = date(cells[:date])
      missing = { part_number: "SASH PART", po_number: "POnumber", invoice_number: "Invoice Number",
                  invoice_date: "Invoice Date", date: "Ship Date / Due Date" }.select { |field, _| row[field].nil? }.values
      row[:problem] = "#{missing.join(', ')} #{missing.one? ? 'is' : 'are'} blank or not a date" if missing.any?
      row
    end

    # An Excel date, or text as 20.02.2026 (day first, as in the list) or 2026-02-20.
    def date(value)
      case value
      when DateTime, Time then value.to_date
      when Date then value
      else
        text = OrderRows::Normalizer.text(value).to_s
        if (m = text.match(/\A(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\z/))
          Date.new(m[3].to_i, m[2].to_i, m[1].to_i)
        elsif text.match?(/\A\d{4}-\d{2}-\d{2}\z/)
          Date.iso8601(text)
        end
      end
    rescue Date::Error
      nil
    end

    # Book 38's rows: each shipment (Invoice No + Qty) of each order as a row of the list, its invoice date from the
    # uploaded SASH India invoice, else today. Orders without a shipment are left out.
    def book_rows(sheet, header_row)
      index = book_index(sheet.row(header_row))
      rows = ((header_row + 1)..sheet.last_row).filter_map do |number|
        cells = sheet.row(number)
        next if cells.all? { |c| OrderRows::Normalizer.text(c).nil? }
        raise InvalidFile, "The file has more than #{MAX_ROWS} rows." if number - header_row > MAX_ROWS

        shipments = index[:invoices].filter_map do |i|
          invoice = OrderRows::Normalizer.text(cells[i])&.first(64)
          [ invoice, cells[i + 1] ] if invoice
        end
        next if shipments.empty?

        shipments.map do |invoice, qty|
          # Today for now (the file has no invoice date); the uploaded invoice's date replaces it below.
          read_row(number, { part_number: cells[index[:part_number]], po_number: cells[index[:po_number]], invoice_number: invoice,
                             qty: qty, date: cells[index[:date]], invoice_date: Date.current })
        end
      end.flatten
      dates = Invoice.where(kind: "india", invoice_number: rows.map { |r| r[:invoice_number] }.uniq, removed_at: nil)
                     .group(:invoice_number).minimum(:invoice_date)
      rows.each { |row| row[:invoice_date] = dates.fetch(row[:invoice_number], row[:invoice_date]) }
    end

    # Book 38's header row: { field => column index, invoices: [column of each shipment's Invoice No] }, else nil.
    def book_index(cells)
      labels = cells.map { |c| canonical(c) }
      found = BOOK_COLUMNS.transform_values { |name| labels.index(canonical(name)) }
      invoices = labels.each_index.select { |i| labels[i] == canonical(BOOK_INVOICE) && labels[i + 1] == canonical("Qty") }
      found.values.all? && invoices.any? ? found.merge(invoices: invoices) : nil
    end

    # { field => column index } when this row has every required header, else nil.
    def header_index(cells)
      labels = cells.map { |c| canonical(c) }
      found = COLUMNS.transform_values { |names| names.map { |name| labels.index(canonical(name)) }.compact.first }
      REQUIRED.all? { |field| found[field] } ? found.compact : nil
    end

    def canonical(value)
      OrderRows::Normalizer.text(value).to_s.downcase.gsub(/[^a-z0-9]/, "")
    end
  end
end
