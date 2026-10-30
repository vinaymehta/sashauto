module Vendors
  # Imports a vendor workbook (like "DTP Details.xlsx"): one row per part and vendor with the columns
  # Part Number (or "Customer Part"), SASH Part, Vendor Part, Description, MOQ, Per Pc Weight in Kg, Vendor Name,
  # Vendor Price.
  # The file is also the source of the product fields: each row sets its Product's SASH Part, Vendor Part,
  # Description, MOQ and Per Pc Weight (blank cells leave the product's value unchanged).
  # Headers are matched by name (case and spaces ignored). Vendors are matched by name and parts by
  # Part Number: existing vendor/part pairs are updated, new ones added. A Part Number not yet in Products is
  # added to Products (source "manual", created by the importing user). Rows without a Part Number or vendor,
  # or with an invalid Part Number, are skipped and reported. Everything is saved in one transaction.
  class Importer
    class InvalidFile < StandardError; end

    # Field => accepted header names (lowercase); the first is the name used in messages.
    COLUMNS = {
      part_number: [ "part number", "customer part" ], sash_part: [ "sash part" ], vendor_part: [ "vendor part" ],
      description: [ "description" ], moq: [ "moq" ], weight_kg: [ "per pc weight in kg" ],
      vendor_name: [ "vendor name" ], price: [ "vendor price" ]
    }.freeze
    REQUIRED = %i[part_number vendor_name].freeze
    # A Vendor Name that only says there is no vendor.
    NO_VENDOR = /\A(?:[-–—.]+|n\/?a|nil|none|na)\z/i
    # A Vendor Name saying the part is discontinued (no more POs).
    DISCONTINUED = /\Adiscontinu/i
    CURRENCY_SYMBOLS = { "$" => "USD", "USD" => "USD", "€" => "EUR", "EUR" => "EUR", "₹" => "INR", "RS" => "INR",
                         "RS." => "INR", "INR" => "INR", "¥" => "CNY", "CNY" => "CNY", "RMB" => "CNY",
                         "£" => "GBP", "GBP" => "GBP" }.freeze

    Result = Data.define(:vendors_created, :products_created, :added, :updated, :skipped, :issues) do
      def to_h = { vendors_created: vendors_created, products_created: products_created, added: added, updated: updated,
                   skipped: skipped, issues: issues }
    end

    # What importing one row did: the product and vendor part it wrote (nil when skipped), whether they were new,
    # and the problems found ({ kind:, field:, message: }); a row with a "skipped" problem wrote nothing.
    RowResult = Data.define(:product, :vendor_product, :product_created, :vendor_created, :added, :problems) do
      def skipped? = problems.any? { |p| p[:kind] == "skipped" }
    end

    # `filename`: the uploaded file's original name, shown on its import issues.
    def self.call(path:, user: nil, filename: nil)
      new(path, user, filename).call
    end

    # Imports one row ({ part_number:, vendor_name:, sash_part:, ... } with the cell values), as the workbook import
    # does. Used for every workbook row, and for an admin fixing a row from the Import issues tab.
    def self.import_row(row, user: nil, vendors: nil)
      new(nil, user).import_row(row, vendors || Vendor.all.index_by { |v| v.name.downcase })
    end

    def initialize(path, user = nil, filename = nil)
      @path = path
      @user = user
      @filename = filename.to_s.first(255).presence || File.basename(path.to_s)
    end

    def call
      sheet = Roo::Excelx.new(@path, extension: :xlsx, file_warning: :ignore).sheet(0)
      raise InvalidFile, "The workbook is empty." unless sheet.first_row

      index = header_index(sheet.row(sheet.first_row))
      counts = Hash.new(0)
      skipped = []
      issues = 0

      VendorProduct.transaction do
        # Importing the same file again replaces its open issues: those still present are recorded anew below.
        ImportIssue.open.where(filename: @filename)
                   .update_all(status: "resolved", resolution: "reimported", resolved_by_id: @user&.id, resolved_at: Time.current,
                               updated_at: Time.current)
        vendors = Vendor.all.index_by { |v| v.name.downcase }
        ((sheet.first_row + 1)..sheet.last_row).each do |number|
          cells = sheet.row(number)
          next if cells.compact.all? { |c| c.to_s.strip.empty? }

          row = COLUMNS.keys.to_h { |key| [ key, index[key] && cells[index[key]] ] }
          result = import_row(row, vendors)
          counts[:products_created] += 1 if result.product_created
          counts[:vendors_created] += 1 if result.vendor_created
          counts[result.added ? :added : :updated] += 1 unless result.skipped?
          result.problems.each { |problem| skipped << { row: number, message: problem[:message] } if problem[:kind] == "skipped" }
          # One issue per row, with all its problems (a skipped row is a skipped issue; the vendor first, as it matters most).
          if result.problems.any?
            problems = result.problems.sort_by { |problem| problem[:field] == "vendor_name" ? 0 : 1 }
            ImportIssue.create!(filename: @filename, excel_row: number, kind: result.skipped? ? "skipped" : problems.first[:kind],
                                field: problems.first[:field], message: problems.map { |problem| problem[:message] }.join(" "),
                                row_data: row_data(row), product: result.product, vendor_product: result.vendor_product, imported_by: @user)
            issues += 1
          end
        end
      end
      OverseasCurrency.apply! # overseas vendors are not on INR (their prices may be written without a currency)
      Result.new(vendors_created: counts[:vendors_created], products_created: counts[:products_created],
                 added: counts[:added], updated: counts[:updated], skipped: skipped.first(200), issues: issues)
    rescue Zip::Error, ArgumentError, Roo::Error => e
      raise InvalidFile, "The file could not be read as an .xlsx workbook (#{e.class.name.demodulize})."
    end

    def import_row(row, vendors)
      name = row[:vendor_name].to_s.squish
      part = OrderRows::Normalizer.part_number(row[:part_number].to_s)
      return skip(:part_number, "Part Number is blank.") if part.blank?
      return skip(:vendor_name, "Vendor Name is blank.") if name.empty?
      # No vendor (a dash, a discontinued part, …): the part is added without one, with a warning. Otherwise one vendor,
      # or several (the part is then made by each of them, at its own price): VendorCell.
      no_vendor = not_a_vendor(name)
      entries = no_vendor ? [] : VendorCell.new(vendors.values).parse(name)
      return skip(:vendor_name, "Vendor Name \"#{name.first(60)}\" could not be read as vendors, so the row was not imported.") if !no_vendor && entries.empty?

      problems = unreadable_values(row)
      # The price is each vendor's in the cell, or there is no vendor to price.
      problems.reject! { |p| p[:field] == "price" } if no_vendor || entries.all?(&:price)
      # "Discontinue Part": no more vendor POs for the part; it is marked Discontinued.
      discontinued = name.match?(DISCONTINUED)
      if discontinued
        problems << { kind: "unreadable", field: "vendor_name", message: "Discontinued part (\"#{name}\"): marked Discontinued, no vendor POs will be placed for it." }
      elsif no_vendor
        problems << { kind: "unreadable", field: "vendor_name", message: "#{no_vendor} The part was added without a vendor." }
      end
      pack = PackParser.pack_size(description: row[:description], moq: row[:moq], price: row[:price])
      moq = PackParser.moq(row[:moq], pack)
      product = Product.find_by(part_number: part)
      product_created = product.nil?
      product ||= Product.create!(part_number: part, source: "manual", created_by: @user)
      product.update!({ sash_part: row[:sash_part].to_s.strip.presence, vendor_part: row[:vendor_part].to_s.strip.presence,
                        description: row[:description].to_s.strip.presence, pack_size: pack,
                        moq: moq&.pcs, moq_sets: moq&.sets, moq_text: moq && file_text(row[:moq]),
                        weight_kg: number_or_nil(row[:weight_kg]), discontinued: (true if discontinued) }.compact)
      vendor_created = false
      added = false
      items = entries.map do |entry|
        vendor = entry.vendor || vendors[entry.name.downcase]
        unless vendor
          vendor = vendors[entry.name.downcase] = Vendor.create!(name: entry.name)
          vendor_created = true
        end
        # An amount without a currency is in the vendor's own currency (e.g. a Chinese vendor's "271.09" is USD).
        text = entry.price || row[:price]
        price = PackParser.price(text, pack, currencies: CURRENCY_SYMBOLS, default: vendor.currency.presence || "INR")
        item = VendorProduct.find_or_initialize_by(vendor: vendor, product: product)
        item.price_source = "import"
        item.price_changed_by = @user
        added ||= item.new_record?
        # A part made by several vendors keeps the cell as its note (who does what).
        note = entries.size > 1 ? [ price.note, "One of #{entries.size} vendors: #{name}" ].compact.join(" · ").first(500) : price.note
        item.update!(sash_part: row[:sash_part], vendor_part: row[:vendor_part], description: row[:description], pack_size: pack,
                     moq: moq&.pcs, moq_sets: moq&.sets, moq_text: moq && file_text(row[:moq]), weight_kg: number_or_nil(row[:weight_kg]),
                     price_amount: price.pc, set_price_amount: price.set, price_currency: price.currency, price_note: note,
                     price_text: price.set && file_text(text))
        item
      end
      RowResult.new(product: product, vendor_product: items.first, product_created: product_created,
                    vendor_created: vendor_created, added: added, problems: problems)
    rescue ActiveRecord::RecordInvalid => e
      field = e.record.is_a?(Product) && e.record.errors.include?(:part_number) ? :part_number : nil
      skip(field, e.record.errors.full_messages.to_sentence)
    end

    private

    def header_index(headers)
      normalized = headers.map { |h| h.to_s.squish.downcase }
      # A column named twice would be read from the wrong one (e.g. "Vendor Name" over the Vendor Part column).
      COLUMNS.each_value do |names|
        at = normalized.each_index.select { |i| names.include?(normalized[i]) }
        next if at.size < 2

        letters = at.map { |i| column_letter(i) }.join(" and ")
        raise InvalidFile, "Column \"#{headers[at.first].to_s.squish}\" appears twice (columns #{letters}). Rename the wrong one " \
                           "(e.g. to \"Vendor Part\" if it holds the vendor's part numbers) and import again."
      end
      index = COLUMNS.transform_values { |names| names.filter_map { |name| normalized.index(name) }.first }
      missing = REQUIRED.reject { |key| index[key] }
      raise InvalidFile, "Missing column(s): #{missing.map { |k| COLUMNS[k].first.titleize }.join(', ')}." if missing.any?
      index
    end

    # 0 => "A", 25 => "Z", 26 => "AA".
    def column_letter(index)
      letters = +""
      index += 1
      while index.positive?
        index, rest = (index - 1).divmod(26)
        letters.prepend((65 + rest).chr)
      end
      letters
    end

    # Why a Vendor Name is not a vendor (the part is added without one, with a warning on the Import issues tab), or
    # nil: a dash or "N/A" (no vendor), a discontinued or cancelled part, no quote yet, or a charge (e.g. air freight).
    # Several vendors in one cell are read by VendorCell.
    def not_a_vendor(name)
      return "Vendor Name is \"#{name}\" (no vendor)." if NO_VENDOR.match?(name)
      return "Vendor Name says \"#{name.first(60)}\", which is not a vendor." if name.match?(/\Adiscontinu|\bno quote\b|\bcancel|\bfreight\b|\bcharges?\z/i)
      nil
    end

    def skip(field, message)
      RowResult.new(product: nil, vendor_product: nil, product_created: false, vendor_created: false, added: false,
                    problems: [ { kind: "skipped", field: field&.to_s, message: message } ])
    end

    # Values present in the row that the import cannot use (they are left blank): MOQ and weight must be numbers,
    # the price must start with a number (otherwise the text is kept as the price note).
    def unreadable_values(row)
      problems = []
      { moq: "MOQ", weight_kg: "Per Pc Weight in Kg" }.each do |field, label|
        value = row[field]
        next if value.nil? || value.to_s.strip.empty? || (field == :moq ? PackParser.moq(value, 1) : number_or_nil(value))
        problems << { kind: "unreadable", field: field.to_s, message: "#{label} \"#{value.to_s.strip.first(80)}\" is not a number, so it was left blank." }
      end
      price = row[:price]
      if price.present? && PackParser.price(price, 1, currencies: CURRENCY_SYMBOLS).set.nil?
        text = price.to_s.gsub(/[[:space:]]+/, " ").strip.first(80)
        currency = text[/\A([A-Z]{3}|£)\s*\d/, 1]
        message = if currency
          "Vendor Price \"#{text}\" is in #{currency == '£' ? 'GBP' : currency}, " \
            "which is not a supported currency (#{VendorProduct::CURRENCIES.join(', ')}), so it was kept as a note."
        else
          "Vendor Price \"#{text}\" has no amount, so it was kept as a note."
        end
        problems << { kind: "unreadable", field: "price", message: message }
      end
      problems
    end

    # The row as stored on an issue: every field as text, as it appeared in the cell.
    def row_data(row)
      row.transform_values { |v| v.nil? ? nil : (v.is_a?(Float) && v == v.floor ? v.to_i.to_s : v.to_s.strip) }
    end

    # A cell as written in the file, for display: "200 of 10 pcs", "₹12 per pc (₹60 per Set)", 200.0 → "200".
    def file_text(value)
      text = value.is_a?(Numeric) ? value.to_d.to_s("F").delete_suffix(".0") : PackParser.text(value)
      text.first(200).presence
    end

    def number_or_nil(value)
      return value.to_d if value.is_a?(Numeric)
      text = value.to_s.strip.delete(",")
      text.match?(/\A\d+(\.\d+)?\z/) ? text.to_d : nil
    end
  end
end
