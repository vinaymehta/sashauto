module Vendors
  # Imports a vendor workbook (like "DTP Details.xlsx"): one row per part and vendor with the columns
  # Customer Part, SASH Part, Vendor Part, Description, MOQ, Per Pc Weight in Kg, Vendor Name, Vendor Price.
  # The file is also the source of the product fields: each row sets its Product's SASH Part, Vendor Part,
  # Description, MOQ and Per Pc Weight (blank cells leave the product's value unchanged).
  # Headers are matched by name (case and spaces ignored). Vendors are matched by name and parts by
  # Part Number: existing vendor/part pairs are updated, new ones added. Rows whose Part Number is not in
  # Products, or without a vendor, are skipped and reported. Everything is saved in one transaction.
  class Importer
    class InvalidFile < StandardError; end

    COLUMNS = {
      part_number: "customer part", sash_part: "sash part", vendor_part: "vendor part", description: "description",
      moq: "moq", weight_kg: "per pc weight in kg", vendor_name: "vendor name", price: "vendor price"
    }.freeze
    REQUIRED = %i[part_number vendor_name].freeze
    CURRENCY_SYMBOLS = { "$" => "USD", "USD" => "USD", "€" => "EUR", "EUR" => "EUR", "₹" => "INR", "RS" => "INR",
                         "RS." => "INR", "INR" => "INR", "¥" => "CNY", "CNY" => "CNY", "RMB" => "CNY" }.freeze
    PRICE = /\A\s*(\$|€|₹|¥|USD|EUR|INR|CNY|RMB|RS\.?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(.*)\z/i

    Result = Data.define(:vendors_created, :added, :updated, :skipped) do
      def to_h = { vendors_created: vendors_created, added: added, updated: updated, skipped: skipped }
    end

    def self.call(path:)
      new(path).call
    end

    # "$1.5 EX CHINA" => [1.5, "USD", "EX CHINA"]; 25.0 => [25.0, "INR", nil]; unreadable text goes to the note.
    def self.parse_price(value)
      return [ nil, "INR", nil ] if value.nil? || value.to_s.strip.empty?
      return [ value.to_d, "INR", nil ] if value.is_a?(Numeric)

      match = PRICE.match(value.to_s)
      return [ nil, "INR", value.to_s.strip.first(200) ] unless match

      [ match[2].delete(",").to_d, CURRENCY_SYMBOLS.fetch(match[1].to_s.upcase, "INR"), match[3].strip.presence ]
    end

    def initialize(path)
      @path = path
    end

    def call
      sheet = Roo::Excelx.new(@path, extension: :xlsx, file_warning: :ignore).sheet(0)
      raise InvalidFile, "The workbook is empty." unless sheet.first_row

      index = header_index(sheet.row(sheet.first_row))
      created = added = updated = 0
      skipped = []

      VendorProduct.transaction do
        vendors = Vendor.all.index_by { |v| v.name.downcase }
        ((sheet.first_row + 1)..sheet.last_row).each do |number|
          cells = sheet.row(number)
          next if cells.compact.all? { |c| c.to_s.strip.empty? }

          row = COLUMNS.keys.to_h { |key| [ key, index[key] && cells[index[key]] ] }
          name = row[:vendor_name].to_s.squish
          part = OrderRows::Normalizer.part_number(row[:part_number].to_s)
          next skipped << { row: number, message: "Vendor Name is blank." } if name.empty?
          product = Product.find_by(part_number: part) if part.present?
          next skipped << { row: number, message: "Part Number #{part.presence || '(blank)'} is not in Products." } unless product

          product.update!({ sash_part: row[:sash_part].to_s.strip.presence, vendor_part: row[:vendor_part].to_s.strip.presence,
                            description: row[:description].to_s.strip.presence, moq: number_or_nil(row[:moq]),
                            weight_kg: number_or_nil(row[:weight_kg]) }.compact)
          vendor = vendors[name.downcase] ||= Vendor.create!(name: name).tap { created += 1 }
          amount, currency, note = self.class.parse_price(row[:price])
          item = VendorProduct.find_or_initialize_by(vendor: vendor, product: product)
          item.new_record? ? added += 1 : updated += 1
          item.update!(sash_part: row[:sash_part], vendor_part: row[:vendor_part], description: row[:description],
                       moq: number_or_nil(row[:moq]), weight_kg: number_or_nil(row[:weight_kg]),
                       price_amount: amount, price_currency: currency, price_note: note)
        rescue ActiveRecord::RecordInvalid => e
          skipped << { row: number, message: e.record.errors.full_messages.to_sentence }
        end
      end
      Result.new(vendors_created: created, added: added, updated: updated, skipped: skipped.first(200))
    rescue Zip::Error, ArgumentError, Roo::Error => e
      raise InvalidFile, "The file could not be read as an .xlsx workbook (#{e.class.name.demodulize})."
    end

    private

    def header_index(headers)
      normalized = headers.map { |h| h.to_s.squish.downcase }
      index = COLUMNS.transform_values { |name| normalized.index(name) }
      missing = REQUIRED.reject { |key| index[key] }
      raise InvalidFile, "Missing column(s): #{missing.map { |k| COLUMNS[k].titleize }.join(', ')}." if missing.any?
      index
    end

    def number_or_nil(value)
      return value.to_d if value.is_a?(Numeric)
      text = value.to_s.strip.delete(",")
      text.match?(/\A\d+(\.\d+)?\z/) ? text.to_d : nil
    end
  end
end
