module Orders
  # Imports SASH India's list of dispatched orders (columns SASH PART, Qty, POnumber, Invoice Number, Invoice Date and
  # SHIP DATE REQD or Due Date): each row whose order is in the current order data (the latest upload of each
  # business) is marked "Dispatched from SASH Faridabad" with its invoice number and date, and "Received at SASH
  # Faridabad" first when it has no such mark yet (statuses go in route order).
  #
  # A row matches the order with its PO Number + Part Number whose Ship Date or Due Date is the row's date (Firm and
  # Order before Forecast, then those with a Qty, then the same Qty, while that leaves several); with none on that date,
  # the one Firm / Order order of the PO + Part with the row's Qty. A row of a combined order marks the combined
  # order (Orders::Combiner), as the Orders page does. Rows of the same order (sent on several invoices) give one mark
  # with all their invoice numbers; importing the list again adds the invoices such a mark does not have yet. Rows that
  # match nothing, or several orders, and orders already dispatched otherwise are skipped and listed with the reason,
  # to be marked by hand.
  #
  #   Orders::DispatchImport.call(path:, user:)   # => Result
  class DispatchImport
    class InvalidFile < StandardError; end

    Result = Data.define(:rows, :orders_marked, :rows_marked, :skipped)

    # Field => accepted headers (compared without case, spaces and punctuation).
    COLUMNS = {
      part_number: [ "SASH PART", "Part Number" ], qty: [ "Qty" ], po_number: [ "POnumber", "PO Number" ],
      invoice_number: [ "Invoice Number" ], invoice_date: [ "Invoice Date" ],
      date: [ "SHIP DATE REQD", "Ship Date", "Due Date" ]
    }.freeze
    REQUIRED = %i[part_number po_number invoice_number invoice_date date].freeze
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
      orders = {} # anchor row id => [anchor row, [file rows]]
      combined = Combiner.for_batches(batch_ids)
      anchor_of = combined.groups.values.select(&:combined?).flat_map { |g| g.members.map { |m| [ m.id, g.anchor_id ] } }.to_h

      rows.each do |row|
        next skipped << skip(row, row[:problem]) if row[:problem]

        match = find_order(row)
        next skipped << skip(row, match) if match.is_a?(String)

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
      Result.new(rows: rows.size, orders_marked: marked, rows_marked: rows_marked, skipped: skipped.sort_by { |s| s[:row] })
    end

    private

    def batch_ids
      @batch_ids ||= UploadBatch.latest_for("all").map(&:id)
    end

    # The order of a file row, or why there is none (a message).
    def find_order(row)
      lines = OrderRow.where(upload_batch_id: batch_ids, po_number: row[:po_number], part_number: row[:part_number])
      return "PO #{row[:po_number]} + Part #{row[:part_number]} is not in the current order data" unless lines.exists?

      on_date = lines.where(ship_date: row[:date]).or(lines.where(due_date: row[:date])).to_a
      return same_qty_order(lines, row) if on_date.empty?

      firm = on_date.reject { |line| line.order_type == "Forecast" }
      on_date = firm if firm.any?
      # Deere's file can list the same order line twice, once without a Qty (nothing required): the one with a Qty.
      with_qty = on_date.select { |line| line.qty.to_d.positive? }
      on_date = with_qty if with_qty.any?
      same_qty = on_date.select { |line| row[:qty] && line.qty == row[:qty] }
      on_date = same_qty if on_date.size > 1 && same_qty.any?
      on_date = distinct_orders(on_date)
      return "#{on_date.size} orders of this PO + Part are on #{row[:date].strftime('%d %b %Y')} (PO Lines #{on_date.map(&:po_line_number).join(', ')})" if on_date.size > 1

      on_date.first
    end

    # No order on the list's date (its date is not always Deere's, e.g. GMBH's Due Date moved): the one Firm / Order
    # order of this PO + Part with the same Qty. Only with the same Qty: an order of the PO + Part on another date with
    # another Qty is a later delivery, not the one dispatched (Deere drops a delivery from its file once received).
    def same_qty_order(lines, row)
      on = row[:date].strftime("%d %b %Y")
      same = distinct_orders(lines.where.not(order_type: "Forecast").where(qty: row[:qty]).to_a) if row[:qty]&.positive?
      return same.first if same&.one?
      return "#{same.size} orders of this PO + Part have Qty #{row[:qty].to_s('F').sub(/\.0\z/, '')} and none is on #{on}" if same&.many?

      "no order of this PO + Part is on #{on} or has its Qty (the delivery is no longer in Deere's file)"
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
      delivery.update!(invoice_lines: file_rows.map { |row| line(row) }.uniq)
      AuditLog.record("order.delivery_marked", subject: delivery, user: @user, kind: "dispatched", po_number: order.po_number,
                                               part_number: order.part_number, source: "dispatched_list")
      nil
    end

    # Adds the rows' invoices to the mark: the ones it does not list yet (its date: the latest invoice date), and the
    # order row each was sent for (invoice_lines; also for a mark made before they were recorded).
    def add_invoices(delivery, file_rows)
      lines = (delivery.invoice_lines + file_rows.map { |row| line(row) }).uniq
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

      header_row = (sheet.first_row..[ sheet.last_row, sheet.first_row + HEADER_SEARCH_ROWS ].min).find { |n| header_index(sheet.row(n)) }
      raise InvalidFile, "Could not find the header row. Expected columns: SASH PART, POnumber, Invoice Number, Invoice Date, SHIP DATE REQD or Due Date." unless header_row

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
