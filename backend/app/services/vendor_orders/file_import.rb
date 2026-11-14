require "roo"

module VendorOrders
  # Records the vendor POs of an uploaded vendor PO list (Purchase orders page): a Deere order dump of one business with
  # Vendor Name, PO Qty Issued and the vendor PO number (DTP: the first "PO Number" column; GMBH: "Purchase Order No.")
  # added to the orders already placed with vendors. Each such Firm / Order row becomes a placement of its order (a
  # combined order's, as Place order does; also an order Deere has dropped since, OrderRow.dropped) with one vendor
  # order: the file's PO number, vendor and Qty (pieces), source "file" (no PDF), ticked Order placed, and its date
  # when the file has a date column (PO Date / Order Date / Purchase Order Date / Vendor PO Date).
  #
  # Uploading again: a row recorded by an earlier upload (same order row and vendor) with the same vendor PO number and
  # Qty is skipped; one with another number or Qty is kept as a conflict (VendorPoImport#conflicts) for the user to override (#override) or keep.
  # A Forecast row is a PO placed for an order already dispatched: it goes to that order (#fulfilled_order).
  # The rows of one file all go in, even several of one order. Otherwise nothing is overwritten: a row whose order is
  # already fully ordered (by POs generated here or earlier uploads) is skipped,
  # as are rows whose order or vendor is not found and rows without a Qty issued; each with the reason,
  # and each an open PurchaseIssue (a row whose vendor was not found is recorded later with the vendor chosen: #place).
  #
  #   import = VendorOrders::FileImport.call(path:, filename:, business: "dtp", user:)   # => VendorPoImport
  #   VendorOrders::FileImport.new(nil, nil, issue.business, user).place_issue(issue, vendor)   # => nil or why not
  class FileImport
    class InvalidFile < StandardError; end

    MAX_ROWS = 20_000
    # The reason of a skipped row, by its start (PurchaseIssue#reason_kind).
    REASON_KINDS = { "vendor " => "vendor", "no " => "order", "already recorded" => "recorded", "the order is already fully" => "recorded",
                     "a Forecast" => "forecast", "this vendor PO is listed twice" => "recorded" }.freeze

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
      batch = UploadBatch.latest_completed(@business) or raise InvalidFile, "#{Business.label(@business)} has no order upload yet."
      @batch = batch
      skipped = []
      record = nil
      VendorOrderPlacement.transaction do
        VendorOrder.connection.execute("SELECT pg_advisory_xact_lock(#{VendorOrder::NUMBER_LOCK_KEY})")
        record = VendorPoImport.create!(business: @business, original_filename: @filename.first(255), uploaded_by: @user, rows_count: rows.size)
        added = Hash.new(0.to_d) # order key => sets recorded by this file so far
        seen = Set.new
        created = 0
        @conflicts = []
        rows.each do |row|
          reason = place(row, record, added, seen)
          unless reason
            PurchaseIssue.close_for!("orders", @business, row, @user) # an issue of this row from an earlier upload
            next created += 1
          end
          next if reason == :conflict

          skipped << skip(row, reason)
          kind = REASON_KINDS.find { |start, _| reason.start_with?(start) }&.last || "other"
          next if kind == "recorded" # nothing to do: it is in already (uploading a list again)

          PurchaseIssue.record!(record, row, reason, kind)
        end
        record.update!(created_count: created, skipped: skipped, conflicts: @conflicts)
        record.file.attach(io: File.open(@path), filename: @filename.first(255).presence || "vendor-pos.xlsx")
        AuditLog.record("vendor_po_import.uploaded", subject: record, user: @user, business: @business, rows: rows.size,
                                                     created: created, skipped: skipped.size)
      end
      record
    end

    # Applies a conflict of an upload (one row uploaded again with another vendor PO number or Qty): the vendor PO
    # recorded from the earlier upload takes the new values.
    def self.override(conflict)
      order = VendorOrder.find_by(id: conflict["vendor_order_id"], source: "file") or return "the vendor PO is no longer there"
      VendorOrder.where(id: order.id).update_all(number: conflict.dig("new", "number"), qty: BigDecimal(conflict.dig("new", "qty").to_s), updated_at: Time.current)
      VendorOrderPlacement.where(id: order.vendor_order_placement_id).update_all(allocated_qty: BigDecimal(conflict.dig("new", "sets").to_s), updated_at: Time.current)
      nil
    end

    # Records the row of an open issue with this vendor (its vendor was not found); returns why not, or nil.
    def place_issue(issue, vendor)
      @batch = UploadBatch.latest_completed(@business)
      row = issue.row_data.symbolize_keys
      row[:date] = row[:date] && Date.iso8601(row[:date])
      row[:order_date] = row[:order_date] && Date.iso8601(row[:order_date])
      row[:issued] = row[:issued] && BigDecimal(row[:issued].to_s)
      VendorOrderPlacement.transaction do
        VendorOrder.connection.execute("SELECT pg_advisory_xact_lock(#{VendorOrder::NUMBER_LOCK_KEY})")
        place(row, issue.vendor_po_import, Hash.new(0.to_d), Set.new, vendor: vendor)
      end
    end

    private

    # Records one file row (with `vendor`, else the vendor of its Vendor Name); returns why not, or nil.
    def place(row, record, added, seen, vendor: nil)
      return "no PO Qty issued" unless row[:issued]&.positive?
      return "no vendor PO number" if row[:vendor_po].blank?

      order = if row[:order_type] == "Forecast"
        fulfilled_order(row) or return "a Forecast line, and PO #{row[:po_number]} has no dispatched order of #{row[:part_number]} without a vendor PO"
      else
        find_order(row) or return "no #{row[:order_type]} of PO #{row[:po_number]} Line #{row[:po_line_number]} on #{row[:date]&.strftime('%d %b %Y') || 'its date'} in the order data"
      end
      vendors = vendor ? [ vendor ] : vendors_of(row)
      return no_vendor(row) if vendors.empty?

      anchor, total = combined_order(order)
      key = VendorOrderPlacement.order_key(anchor)
      own_key = VendorOrderPlacement.order_key(order)
      product = Product.find_by(part_number: anchor.part_number)
      sets = (row[:issued] / [ product&.pack_size.to_i, 1 ].max).round(3)
      split = split_cell(row[:vendor_po], vendors)
      numbers = split.transform_values(&:first)
      pieces = split.transform_values { |_, qty| qty || row[:issued] }
      return "this vendor PO is listed twice in the file for the order" unless vendors.all? { |v| seen.add?([ key, v.id, numbers[v] ]) }

      # The same row (its order row and vendor) recorded by an earlier upload: the same vendor PO number and Qty are
      # skipped; another number or Qty becomes a conflict to override. (When the row has several earlier POs, only the
      # one with its number is the same; a new number is then another PO.) Done per vendor of the row.
      joined = nil # the placement of this row from an earlier upload: other vendors of the row join it
      fresh = vendors.reject do |v|
        earlier = VendorOrder.joins(:vendor_order_placement).where(vendor: v, source: "file", source_order_key: own_key)
        earlier = earlier.where.not(vendor_order_placements: { vendor_po_import_id: record.id }) if record
        same = earlier.find_by(number: numbers[v]) || (earlier.count == 1 ? earlier.first : nil)
        joined ||= same&.vendor_order_placement
        next true if same && same.number == numbers[v] && same.qty == pieces[v]

        if same
          @conflicts << { id: @conflicts.size + 1, kind: "orders", status: "open", row: row[:row], part_number: anchor.part_number, po_number: anchor.po_number,
                          ship_date: anchor.ship_date.iso8601, vendor: v.name, vendor_order_id: same.id,
                          old: { number: same.number, qty: same.qty.to_s("F") }, new: { number: numbers[v], qty: pieces[v].to_s("F"), sets: sets.to_s("F") } }
          next true
        end
        VendorOrder.joins(:vendor_order_placement).where(number: numbers[v], vendor: v, vendor_order_placements: { order_key: key }).exists?
      end
      return :conflict if fresh.empty? && @conflicts&.any? { |c| c[:row] == row[:row] }
      return "already recorded (vendor PO #{vendors.map { |v| numbers[v] }.join(' & ')})" if fresh.empty?

      order_qty = total&.positive? ? total : sets
      # Only POs from before this file count: the rows of one file (e.g. each order of a combined order) all go in.
      before = VendorOrderPlacement.ordered_qty(key) - added[key]
      if total&.positive? && before >= total && joined.nil?
        taken = VendorOrder.joins(:vendor_order_placement).where(vendor_order_placements: { order_key: key }).pluck(:number).uniq
        return "the order is already fully ordered (#{taken.first(3).join(', ').presence || 'a PO'}); not overwritten"
      end

      now = Time.current
      # One placement for the row; a row naming several vendors of the part (e.g. casting and machining) gives each of
      # them a vendor order for the same pieces, at its price in Products. The pieces are ordered once: a vendor added
      # to a row recorded before joins its placement.
      placement = joined || VendorOrderPlacement.create!(
        order_key: key, order_row: anchor, upload_batch: anchor.upload_batch, product: product, vendor_po_import: record,
        po_number: anchor.po_number, po_line_number: anchor.po_line_number, part_number: anchor.part_number,
        order_type: anchor.order_type, ship_date: anchor.ship_date, due_date: anchor.due_date, unit: anchor.unit&.strip,
        order_qty: order_qty, allocated_qty: sets.positive? ? sets : nil, moq: product && (product.moq_sets || product.moq),
        placed_by: @user, placed_at: now
      )
      links = product ? product.vendor_products.where(vendor: fresh).index_by(&:vendor_id) : {}
      fresh.each do |v|
        link = links[v.id]
        VendorOrder.create!(vendor_order_placement: placement, vendor: v, number: numbers[v].first(255), qty: pieces[v],
                            unit: "pcs", source: "file", email_status: "no_email", order_placed_at: now, order_placed_by: @user,
                            order_date: row[:order_date], source_order_key: own_key,
                            unit_price: vendors.size > 1 ? link&.price_amount : nil, price_currency: vendors.size > 1 ? link&.price_currency : nil)
      end
      added[key] += sets unless joined
      nil
    end

    # Why a row has no vendor: its name is no vendor, and its part has none in Products to take one from.
    def no_vendor(row)
      product = Product.find_by(part_number: row[:part_number])
      return "vendor \"#{row[:vendor]}\" is not in Vendors" unless product
      return "vendor \"#{row[:vendor]}\" is not in Vendors, and part #{product.part_number} has several vendors in Products: choose one" if product.vendor_products.count > 1

      "vendor \"#{row[:vendor]}\" is not in Vendors, and part #{product.part_number} (#{product.description}) has no vendor in Products"
    end

    # The vendors of a row's Vendor Name cell: several when it names two or more of the part's vendors in Products
    # ("AAYESS CASTING @ Rs 2070, GB Ingeneure @ Rs 735": Aay Ess Castings and GB Ingeneure), else the one it names
    # (VendorMatch). Empty when none.
    def vendors_of(row)
      @vendor_match ||= VendorMatch.new
      named = @vendor_match.named_in(row[:vendor], part_number: row[:part_number])
      return named if named.size > 1

      # A PO cell with a number per vendor, each ending in the code of one of the part's vendors ("…/AT -500 &
      # …/HC - 500", while the Vendor Name spells one of them wrongly: "Hurlimun Casters"): each of those vendors.
      coded = @vendor_match.coded_in(row[:vendor_po], part_number: row[:part_number])
      return coded if coded.size > 1

      # A cell naming several vendors ("JTB Hydraulic Industries & S.B Auto"): each of them, when every name is a vendor.
      names = row[:vendor].to_s.split(/\s*[&,+]\s*|\s+and\s+/i).reject(&:blank?)
      if names.size > 1
        each = names.map { |n| @vendor_match.find(n) }
        return each.uniq if each.all? && each.uniq.size == names.size
      end

      found = @vendor_match.find(row[:vendor], part_number: row[:part_number])
      found ? [ found ] : named
    end

    # Each vendor's [vendor PO number, Qty or nil] in a PO cell that may list several ("5501072400-SEP/AEC &
    # 5501072367-SEP/GB", "…/JTB - 35 pcs , …/SB - 465 pcs"): the number ending in its code, the acronym of its name or
    # its first word, else one whose ending and code start alike, else (one left of each) the number no other vendor
    # took. One vendor, or a vendor no number fits: the whole cell and no Qty (each vendor then gets the row's Qty).
    def split_cell(cell, vendors)
      return { vendors.first => [ cell, nil ] } if vendors.size == 1

      entries = cell.split(/\s*(?:&|,)\s*/).filter_map do |part|
        qty = part[/\s*-\s*(\d[\d.,]*)\s*(?:pcs)?\s*\z/i, 1]
        number = part.sub(/\s*-\s*\d[\d.,]*\s*(?:pcs)?\s*\z/i, "").strip
        suffix = number.split("/").last.to_s.downcase.gsub(/[^a-z0-9]/, "")
        [ number, qty && BigDecimal(qty.delete(",")), suffix ] unless number.empty? || suffix.empty?
      end
      # Codes of one letter ("s" of "S.B. Auto") would fit any ending starting with it.
      codes = vendors.to_h do |v|
        [ v, [ v.code, VendorOrder.acronym(v.name), VendorMatch.normalize(v.name).split.first ].compact.map { |c| c.to_s.downcase.delete(" ") }.select { |c| c.length > 1 } ]
      end
      taken = {}
      [ ->(c, suffix) { c.include?(suffix) },
        ->(c, suffix) { c.any? { |x| x.start_with?(suffix) || suffix.start_with?(x) } } ].each do |fits|
        vendors.each do |v|
          next if taken[v]

          entry = entries.find { |e| !taken.value?(e) && fits.(codes[v], e[2]) }
          taken[v] = entry if entry
        end
      end
      left = vendors.reject { |v| taken[v] }
      rest = entries.reject { |e| taken.value?(e) }
      taken[left.first] = rest.first if left.one? && rest.one?
      vendors.to_h { |v| [ v, taken[v] ? taken[v].first(2) : [ cell, nil ] ] }
    end

    # The order row of a file row: the current order data's row of its PO + Part + Type + PO Line on its date (Ship Date
    # or Due Date; the one with a Qty when Deere lists it twice), else that order in an earlier upload (dropped since).
    def find_order(row)
      return nil unless row[:date]

      scope = { po_number: row[:po_number], part_number: row[:part_number], order_type: row[:order_type], po_line_number: row[:po_line_number] }
      on = ->(rel) { rel.where(ship_date: row[:date]).or(rel.where(due_date: row[:date])).to_a.max_by { |r| [ r.qty.to_d, -r.id ] } }
      on.(OrderRow.where(upload_batch_id: @batch.id, **scope)) || on.(OrderRow.dropped([ @batch.id ], **scope.except(:order_type, :po_line_number))
                                                                         .where(order_type: row[:order_type], po_line_number: row[:po_line_number]))
    end

    # A Forecast row of the list is a vendor PO SASH placed for an order already dispatched (Deere has since dropped
    # that order or moved its line to Forecast): the Firm / Order of its PO + Part, in any upload of the business, that
    # was dispatched or delivered (a status mark or an uploaded invoice) and has no vendor PO yet. The one with the
    # row's Qty, else the earliest; each version of an order counts once, with its largest Qty. nil when none.
    def fulfilled_order(row)
      # The row's PO first, then a Deere PO written in its vendor PO number ("4500448537/AT" on a row of PO 5500929704).
      pos = [ row[:po_number], *row[:vendor_po].to_s.scan(/(?<!\d)(?:45|55)\d{8}(?!\d)/) ].uniq
      pos.each do |po|
        order = fulfilled_order_of(row, po)
        return order if order
      end
      nil
    end

    def fulfilled_order_of(row, po_number)
      rows = OrderRow.joins(:upload_batch).where(upload_batches: { business: @business }, po_number: po_number,
                                                 part_number: row[:part_number], order_type: %w[Firm Order]).where("order_rows.qty > 0")
      orders = rows.to_a.group_by { |r| VendorOrderPlacement.order_key(r) }.transform_values { |v| v.max_by { |r| [ r.qty, r.upload_batch_id ] } }
      return nil if orders.empty?

      keys = orders.keys
      # Recorded by an earlier upload (its vendor PO number on one of these orders, the one with the row's Qty first):
      # that order, so the row is checked as the same row (skipped, or a conflict when it changed).
      recorded = VendorOrder.where(source: "file", source_order_key: keys).where("strpos(?, vendor_orders.number) > 0", row[:vendor_po].to_s)
                            .order(Arel.sql(VendorOrder.sanitize_sql_array([ "(vendor_orders.qty = ?) DESC, vendor_orders.id", row[:issued] ]))).pick(:source_order_key)
      return orders[recorded] if recorded

      sent = OrderDelivery.where(removed_at: nil, kind: %w[dispatched inbound outbound], order_key: keys).distinct.pluck(:order_key) |
             InvoiceAllocation.joins(:invoice).where(invoices: { removed_at: nil }, order_key: keys).distinct.pluck(:order_key)
      free = orders.slice(*(sent - VendorOrderPlacement.where(order_key: keys).distinct.pluck(:order_key))).values
      return free.min_by { |r| [ r.qty == row[:issued] ? 0 : 1, r.ship_date ] } if free.any?

      # Else the order whose Qty less the pieces its vendor POs already order is just the row's Qty (a PO for the rest
      # of an order: 1,800 of an order of 2,000 with a PO of 200).
      ordered = VendorOrder.joins(:vendor_order_placement).where(vendor_order_placements: { order_key: keys }).group("vendor_order_placements.order_key").sum(:qty)
      orders.values.select { |r| ordered[VendorOrderPlacement.order_key(r)] && r.qty - ordered[VendorOrderPlacement.order_key(r)] == row[:issued] }.min_by(&:ship_date)
    end

    # The order a row belongs to: its combined order's first row and total Qty (Orders::Combiner), else itself and its Qty.
    def combined_order(order)
      return [ order, order.qty ] unless order.upload_batch_id == @batch.id

      @groups ||= Orders::Combiner.call(@batch.id).groups.values.select(&:combined?)
      group = @groups.find { |g| g.members.any? { |m| m.id == order.id } }
      group ? [ OrderRow.find(group.anchor_id), group.total ] : [ order, order.qty ]
    end

    def skip(row, reason)
      { row: row[:row], part_number: row[:part_number], po_number: row[:po_number], vendor: row[:vendor], vendor_po: row[:vendor_po],
        reason: reason }
    end

    # The file's rows with a vendor PO: { row:, order_type:, po_number:, po_line_number:, part_number:, date:, vendor:,
    # vendor_po:, issued: }.
    def read_rows
      sheet = Roo::Spreadsheet.open(@path, extension: File.extname(@filename).delete(".").presence || "xlsx").sheet(0)
      header_row = (1..[ sheet.last_row.to_i, 20 ].min).find { |i| sheet.row(i).any? { |c| canonical(c) == "vendorname" } }
      raise InvalidFile, "No \"Vendor Name\" column was found: upload the order dump with the vendor PO details." unless header_row

      labels = sheet.row(header_row).map { |c| canonical(c) }
      at = ->(*names) { names.filter_map { |n| labels.index(n) }.first }
      line = at.("polinenumber")
      deere_po = line && labels[line - 1] == "ponumber" ? line - 1 : labels.rindex("ponumber")
      vendor_po = at.("purchaseorderno") || labels.each_index.find { |i| labels[i] == "ponumber" && i != deere_po }
      index = { type: at.("type"), vendor: at.("vendorname"), issued: at.("poqtyissued"), vendor_po: vendor_po, po: deere_po, line: line,
                part: at.("partnumber"), ship: at.("shipdate"), due: at.("duedate"),
                order_date: at.("podate", "orderdate", "purchaseorderdate", "vendorpodate", "dateoforder", "podt") }
      missing = index.except(:ship, :due, :order_date).select { |_, i| i.nil? }.keys
      raise InvalidFile, "The file has no #{missing.join(', ')} column." if missing.any?
      raise InvalidFile, "The file has more than #{MAX_ROWS} rows." if sheet.last_row.to_i - header_row > MAX_ROWS

      ((header_row + 1)..sheet.last_row.to_i).filter_map do |number|
        cells = sheet.row(number)
        vendor = OrderRows::Normalizer.text(cells[index[:vendor]])
        po_text = OrderRows::Normalizer.text(cells[index[:vendor_po]])
        next if vendor.nil? && po_text.nil?

        type = OrderRows::Normalizer.text(cells[index[:type]]).to_s
        type = OrderRows::Normalizer::ORDER_TYPES.find { |t| t.casecmp?(type) } || type
        line_value = cells[index[:line]]
        { row: number, order_type: type, po_number: OrderRows::Normalizer.text(cells[index[:po]]).to_s,
          po_line_number: line_value.is_a?(Numeric) ? format("%05d", line_value.to_i) : OrderRows::Normalizer.text(line_value).to_s,
          part_number: OrderRows::Normalizer.part_number(OrderRows::Normalizer.text(cells[index[:part]]).to_s),
          date: date(index[:ship] && cells[index[:ship]]) || date(index[:due] && cells[index[:due]]),
          vendor: vendor.to_s, vendor_po: po_text.to_s.squish, issued: qty(cells[index[:issued]]),
          order_date: index[:order_date] && date(cells[index[:order_date]]) }
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

    def qty(value)
      return nil if value.nil? || value.to_s.strip.empty?

      BigDecimal(value.to_s.delete(",").strip)
    rescue ArgumentError
      nil
    end
  end
end
