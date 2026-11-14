require "roo"

module VendorOrders
  # Records the goods vendors delivered, from an uploaded Purchase Received file of one business (Purchase orders
  # page): one row per vendor invoice line with Vendor Invoice Date, Vendor Invoice No., Part, the vendor (the
  # "Description" column, or Vendor / Vendor Name), Quantity, Rate and Value. Each row's Qty goes to the vendor POs of
  # that part and vendor (generated here or from a vendor PO list), oldest order date first, each taking what it still
  # has open, and what is left beyond them to the latest one (goods received are always recorded); a vendor PO
  # received in full is ticked Goods received (VendorOrder#sync_received!).
  #
  # Uploading again: an invoice's lines of a part and vendor recorded by an earlier upload (or by hand) with the same
  # total Qty are skipped; with another Qty they are kept as a conflict (VendorPoImport#conflicts) for the user to
  # override (#override: the earlier receipts are replaced by the file's) or keep. Otherwise nothing is overwritten. Rows
  # whose vendor or vendor PO is not found are skipped, each with the reason and an open PurchaseIssue (a row whose
  # vendor was not found is recorded later with the vendor chosen). Qty beyond the vendor POs is recorded too (on the
  # latest PO), not an issue.
  #
  #   VendorOrders::ReceivedImport.call(path:, filename:, business: "dtp", user:)   # => VendorPoImport (kind "received")
  class ReceivedImport
    class InvalidFile < StandardError; end

    MAX_ROWS = 20_000
    EXCEL_EPOCH = Date.new(1899, 12, 30) # a number cell shown as a date: its days since this are the number

    def self.call(path:, filename:, business:, user:)
      new(path, filename, business, user).call
    end

    def initialize(path, filename, business, user)
      @path = path
      @filename = filename.to_s
      @business = business
      @user = user
    end

    def call
      rows = read_rows
      record = nil
      VendorOrderReceipt.transaction do
        record = VendorPoImport.create!(kind: "received", business: @business, original_filename: @filename.first(255), uploaded_by: @user,
                                        rows_count: rows.size)
        skipped = []
        created = 0
        @conflicts = []
        @group_vendor = {}
        @in_file = rows.group_by { |r| [ r[:invoice_number], r[:part_number], VendorMatch.normalize(r[:vendor]) ] }
        rows.each do |row|
          reason, kind = receive(row, record)
          next if reason == :conflict

          PurchaseIssue.close_for!("received", @business, row, @user) unless reason # an issue of this row from an earlier upload
          created += 1 if reason.nil? || kind == "partial"
          next unless reason

          skipped << { row: row[:row], part_number: row[:part_number], po_number: nil, vendor: row[:vendor], vendor_po: row[:invoice_number], reason: reason }
          next if kind == "recorded" # nothing to do: it is in already (uploading a file again)

          PurchaseIssue.record!(record, row, reason, kind == "partial" ? "received" : kind)
        end
        # What each invoice line group had in this file, except those left as conflicts (until overridden).
        totals = @in_file.each_with_object({}) do |(_, group), acc|
          vendor = @group_vendor[group.first[:row]] or next
          key = line_key(group.first, vendor)
          acc[key] = group.sum { |r| r[:qty].to_d }.to_s("F") unless @conflicts.any? { |c| c[:line_key] == key }
        end
        record.update!(created_count: created, skipped: skipped, conflicts: @conflicts, line_totals: totals)
        record.file.attach(io: File.open(@path), filename: @filename.first(255).presence || "purchase-received.xlsx")
        AuditLog.record("purchase_received.uploaded", subject: record, user: @user, business: @business, rows: rows.size,
                                                      created: created, skipped: skipped.size)
      end
      record
    end

    # Applies a conflict of an upload (an invoice's lines of a part uploaded again with another Qty): the earlier
    # receipts are replaced by the file's lines. Returns why not, or nil.
    def override(conflict, record)
      record.update!(line_totals: record.line_totals.merge(conflict["line_key"] => conflict.dig("new", "qty"))) if conflict["line_key"]
      VendorOrderReceipt.transaction do
        old = VendorOrderReceipt.where(id: conflict["receipt_ids"]).to_a
        orders = old.map(&:vendor_order).uniq
        old.each(&:destroy!)
        orders.each { |o| o.reload.sync_received!(@user) }
        vendor = Vendor.find_by(id: conflict["vendor_id"])
        conflict["rows"].each do |data|
          row = data.symbolize_keys
          row[:received_on] = row[:received_on] && Date.iso8601(row[:received_on])
          %i[qty rate value].each { |k| row[k] = row[k] && BigDecimal(row[k].to_s) }
          reason, kind = receive(row, record, vendor: vendor, replacing: true)
          raise ActiveRecord::Rollback if reason && kind != "partial"
        end
      end
      nil
    end

    # Records the row of an open issue with this vendor (its vendor was not found); returns why not, or nil.
    def receive_issue(issue, vendor)
      row = issue.row_data.symbolize_keys
      row[:received_on] = row[:received_on] && Date.iso8601(row[:received_on])
      %i[qty rate value].each { |k| row[k] = row[k] && BigDecimal(row[k].to_s) }
      VendorOrderReceipt.transaction do
        reason, kind = receive(row, issue.vendor_po_import, vendor: vendor)
        kind == "partial" ? nil : reason
      end
    end

    private

    # Records one row; returns nil, or [why not (or what was left out), reason kind ("partial": part recorded)].
    def receive(row, record, vendor: nil, replacing: false)
      return [ "no Quantity", "qty" ] unless row[:qty]&.positive?
      return [ "no Vendor Invoice No.", "other" ] if row[:invoice_number].blank?

      # A part written with a suffix ("JXAUC10057-2") that is not a product: the product without it.
      if (base = row[:part_number].to_s[/\A(.+)-\d+\z/, 1]) && !Product.exists?(part_number: row[:part_number]) && Product.exists?(part_number: base)
        row = row.merge(part_number: base)
      end
      vendor ||= (@vendors ||= VendorMatch.new).find(row[:vendor], part_number: row[:part_number]) or return [ "vendor \"#{row[:vendor]}\" is not in Vendors", "vendor" ]
      # A vendor saved twice (under one name, or spelt a little differently: "Pal Shell Cast" / "Pal Shellcast Private
      # Limited", "Polestar Enggineers" / "Polestar Engineers"): the one its POs of the part were recorded with.
      with_po = VendorOrder.joins(:vendor_order_placement).where(vendor_order_placements: { part_number: row[:part_number] }).distinct.pluck(:vendor_id)
      unless with_po.include?(vendor.id)
        vendor = ((@vendors ||= VendorMatch.new).twins(vendor) + Vendor.where(id: with_po).select { |v| VendorMatch.alike?(v.name, vendor.name) })
                 .find { |v| with_po.include?(v.id) } || vendor
        # The part's own vendor (Products) when its POs were listed under one vendor that is not the part's (a wrong
        # Vendor Name in the PO list: Meko for Makhija's water pump): those POs.
        unless with_po.include?(vendor.id)
          own = Vendor.joins(vendor_products: :product).where(products: { part_number: row[:part_number] }).distinct.pluck(:id)
          others = with_po - own
          vendor = Vendor.find(others.first) if own.include?(vendor.id) && others.one? && (with_po & own).empty?
        end
      end
      orders = VendorOrder.joins(:vendor_order_placement).left_joins(vendor_order_placement: :upload_batch)
                          .where(vendor: vendor, vendor_order_placements: { part_number: row[:part_number] })
      orders = orders.where(upload_batches: { business: @business }).or(orders.where(vendor_order_placements: { upload_batch_id: nil }))
      return [ "no vendor PO of #{row[:part_number]} with #{vendor.name}", "order" ] unless orders.exists?
      # Recorded by an earlier upload or by hand (one invoice can have several lines of a part: all of this file go in):
      # the same Qty as the earlier file had (or as recorded, by hand) is skipped, another one becomes a conflict.
      earlier = VendorOrderReceipt.where(vendor_order_id: orders.select("vendor_orders.id"), invoice_number: row[:invoice_number])
      earlier = earlier.where.not(vendor_po_import_id: record.id).or(earlier.where(vendor_po_import_id: nil)) if record
      group = @in_file&.fetch([ row[:invoice_number], row[:part_number], VendorMatch.normalize(row[:vendor]) ], [ row ]) || [ row ]
      @group_vendor[group.first[:row]] = vendor if @group_vendor
      if !replacing && earlier.exists?
        file_qty = group.sum { |r| r[:qty].to_d }
        key = line_key(row, vendor)
        before = VendorPoImport.where(kind: "received", business: @business).where.not(id: record&.id).order(id: :desc)
                               .where("line_totals ? :k", k: key).pick(Arel.sql("line_totals->>#{VendorPoImport.connection.quote(key)}"))
        before_qty = before ? BigDecimal(before) : earlier.sum(:qty)
        return [ "already recorded (invoice #{row[:invoice_number]})", "recorded" ] if before_qty == file_qty

        if group.first.equal?(row) || group.first[:row] == row[:row]
          @conflicts << { id: @conflicts.size + 1, kind: "received", status: "open", row: row[:row], part_number: row[:part_number],
                          invoice_number: row[:invoice_number], vendor: vendor.name, vendor_id: vendor.id, receipt_ids: earlier.pluck(:id),
                          line_key: key, old: { qty: before_qty.to_s("F"), received_on: earlier.minimum(:received_on)&.iso8601 },
                          new: { qty: file_qty.to_s("F"), received_on: row[:received_on]&.iso8601 },
                          rows: group.map { |r| r.transform_values { |v| v.is_a?(Date) ? v.iso8601 : v.is_a?(BigDecimal) ? v.to_s("F") : v } } }
        end
        return [ :conflict, nil ]
      end

      left = row[:qty]
      sorted = orders.order(Arel.sql("COALESCE(vendor_orders.order_date, vendor_order_placements.placed_at::date), vendor_order_placements.placed_at, vendor_orders.id")).to_a
      sorted.each do |order|
        break unless left.positive?

        take = [ order.qty - order.received_qty, left ].min
        next unless take.positive?

        add_receipt(order, row, take, record)
        left -= take
      end
      # Goods received are recorded, even beyond what the vendor POs still had open: the rest goes to the latest PO.
      add_receipt(sorted.last, row, left, record) if left.positive?
      nil
    end

    def add_receipt(order, row, qty, record)
      VendorOrderReceipt.create!(vendor_order: order, received_on: row[:received_on] || Date.current, invoice_number: row[:invoice_number].first(255),
                                 qty: qty, rate: row[:rate], value: row[:rate] && (qty * row[:rate]).round(2), vendor_po_import: record,
                                 created_by: @user)
      order.sync_received!(@user)
    end

    # The key of an invoice's lines of a part from a vendor (VendorPoImport#line_totals).
    def line_key(row, vendor)
      [ row[:invoice_number], row[:part_number], vendor.id ].join("|")
    end

    # The file's rows: { row:, received_on:, invoice_number:, part_number:, vendor:, qty:, rate:, value: }.
    def read_rows
      sheet = Roo::Spreadsheet.open(@path, extension: File.extname(@filename).delete(".").presence || "xlsx").sheet(0)
      header_row = (1..[ sheet.last_row.to_i, 20 ].min).find { |i| sheet.row(i).any? { |c| canonical(c).include?("invoiceno") } }
      raise InvalidFile, "No \"Vendor Invoice No.\" column was found: upload the Purchase Received file." unless header_row

      labels = sheet.row(header_row).map { |c| canonical(c) }
      at = ->(*names) { names.filter_map { |n| labels.index(n) }.first }
      index = { date: at.("vendorinvoicedate", "invoicedate", "date"), invoice: at.("vendorinvoiceno", "invoiceno", "vendorinvoicenumber"),
                part: at.("part", "partnumber", "partno"), vendor: at.("vendorname", "vendor", "description"),
                qty: at.("quantity", "qty"), rate: at.("rate"), value: at.("value", "amount") }
      missing = index.slice(:invoice, :part, :vendor, :qty).select { |_, i| i.nil? }.keys
      raise InvalidFile, "The file has no #{missing.join(', ')} column." if missing.any?
      raise InvalidFile, "The file has more than #{MAX_ROWS} rows." if sheet.last_row.to_i - header_row > MAX_ROWS

      ((header_row + 1)..sheet.last_row.to_i).filter_map do |line_no|
        cells = sheet.row(line_no)
        part = OrderRows::Normalizer.text(cells[index[:part]])
        next if part.nil?

        invoice = cells[index[:invoice]]
        { row: line_no, received_on: index[:date] && date(cells[index[:date]]),
          invoice_number: (invoice.is_a?(Float) && invoice == invoice.to_i ? invoice.to_i.to_s : OrderRows::Normalizer.text(invoice).to_s).squish,
          part_number: OrderRows::Normalizer.part_number(part), vendor: OrderRows::Normalizer.text(cells[index[:vendor]]).to_s,
          qty: number(cells[index[:qty]]), rate: index[:rate] && number(cells[index[:rate]]), value: index[:value] && number(cells[index[:value]]) }
      end
    rescue Zip::Error, ArgumentError, IOError => e
      raise InvalidFile, "The file could not be read as a spreadsheet (#{e.class.name.demodulize})."
    end

    def canonical(value)
      value.to_s.downcase.gsub(/[^a-z0-9]/, "")
    end

    def date(value)
      return nil if value.nil? || value.to_s.strip.empty?
      return value.to_date if value.respond_to?(:to_date) && !value.is_a?(String)

      OrderRows::Normalizer.date(value)
    rescue OrderRows::Normalizer::InvalidValue, Date::Error
      nil
    end

    # A number, also one Excel shows as a date (the Quantity and Rate cells of SASH's file are formatted as dates).
    def number(value)
      return nil if value.nil? || value.to_s.strip.empty?
      # A time of day is a fraction of a day: Rate 3.5 shows as 02 Jan 1900 12:00.
      return BigDecimal((value.to_datetime - EXCEL_EPOCH.to_datetime).to_r, 12).round(4) if value.is_a?(Date) || value.is_a?(Time)

      BigDecimal(value.to_s.delete(",").strip)
    rescue ArgumentError
      nil
    end
  end
end
