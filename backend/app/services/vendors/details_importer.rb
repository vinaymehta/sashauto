require "roo"

module Vendors
  # Imports vendor details from either Excel file (recognised by its headers):
  #   * the vendor master file: Vendor Code, Vendor Name, Address 1/2, ContactNo, contact Name, Email ID, GSTIN,
  #     Lead Days, Payment Terms, GST Status
  #   * the jurisdictional tax officer file: Vendor Name, Vendor Address, GST No, Administrative Office
  # Each row updates an existing vendor, matched by Vendor Code, then by name (ignoring case, punctuation and words
  # like Pvt / Ltd), then by GSTIN, then by a shared email address. A row of the vendor master file that matches no
  # vendor adds one, unless its name shares its key word with an existing vendor ("Globe Electro Forge" and "Globe
  # Rectifiers"): that may be the same company under another name, so it is not added. The tax officer file only
  # updates vendors. Rows not saved become import issues (kind "vendor_details", with the row's details), to be linked
  # to a vendor or added as a new one on the Import issues tab; importing the same file again replaces its open issues.
  # Existing vendors are never renamed. All rows are saved together, or none.
  class DetailsImporter
    class InvalidFile < StandardError; end

    # issues: rows not saved (recorded as import issues).
    Result = Data.define(:kind, :rows, :created, :updated, :unchanged, :issues)

    NAME_NOISE = %w[pvt private ltd limited llp inc co company corp corporation the].freeze
    # Words too common to tell two vendors apart (for the possible-duplicate check).
    GENERIC_WORDS = %w[shri shree sri new india indian industrial industries enterprises engineering engg auto automotive works
                       international impex exports export traders trading products components manufacturing and].freeze
    # GSTIN state codes (first two digits) => state, for the place of supply.
    STATES = {
      "01" => "Jammu and Kashmir", "02" => "Himachal Pradesh", "03" => "Punjab", "04" => "Chandigarh", "05" => "Uttarakhand",
      "06" => "Haryana", "07" => "Delhi", "08" => "Rajasthan", "09" => "Uttar Pradesh", "10" => "Bihar", "11" => "Sikkim",
      "12" => "Arunachal Pradesh", "13" => "Nagaland", "14" => "Manipur", "15" => "Mizoram", "16" => "Tripura", "17" => "Meghalaya",
      "18" => "Assam", "19" => "West Bengal", "20" => "Jharkhand", "21" => "Odisha", "22" => "Chhattisgarh", "23" => "Madhya Pradesh",
      "24" => "Gujarat", "26" => "Dadra and Nagar Haveli and Daman and Diu", "27" => "Maharashtra", "29" => "Karnataka", "30" => "Goa",
      "31" => "Lakshadweep", "32" => "Kerala", "33" => "Tamil Nadu", "34" => "Puducherry", "35" => "Andaman and Nicobar Islands",
      "36" => "Telangana", "37" => "Andhra Pradesh", "38" => "Ladakh"
    }.freeze
    GSTIN = /\A\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\z/

    def self.call(path:, user: nil, filename: nil)
      new(path, user: user, filename: filename).call
    end

    # True when the file is the vendor details or the tax officer file (recognised by its headers).
    def self.handles?(path)
      new(path).send(:find_header)
      true
    rescue InvalidFile
      false
    end

    def self.normalize_name(name)
      name.to_s.downcase.gsub("&", " and ").gsub(/[^a-z0-9]+/, " ").split.reject { |w| NAME_NOISE.include?(w) }.join(" ")
    end

    # The name's first distinctive word ("globe" for "Globe Rectifiers"), or nil.
    def self.key_word(name)
      normalize_name(name).split.find { |word| word.length >= 3 && !GENERIC_WORDS.include?(word) }
    end

    def initialize(path, user: nil, filename: nil)
      @user = user
      @filename = filename.to_s.first(255).presence || File.basename(path)
      @sheet = Roo::Excelx.new(path).sheet(0)
    rescue StandardError => e
      raise InvalidFile, "The file could not be read as an Excel workbook (#{e.class})."
    end

    def call
      header_row, columns = find_header
      @kind = columns.key?("vendor code") ? :details : :tax_officer
      index_vendors
      # First every row is matched, so a look-alike vendor that another row of the file matches is known to be a
      # different company (Paramount Agriparts vs Paramount Impex) and not taken for a duplicate.
      entries = ((header_row + 1)..@sheet.last_row.to_i).filter_map do |r|
        cell = ->(name) { columns[name] && clean(@sheet.cell(r, columns[name])) }
        name = cell.("vendor name")
        next if name.nil?

        code = @kind == :details ? cell.("vendor code")&.upcase : nil
        gst = (cell.("gstin") || cell.("gst no"))&.upcase&.delete(" ")
        vendor, reason = find_vendor(code, name, gst, emails(cell.("email id")))
        { row: r, cell: cell, name: name, code: code, gst: gst, vendor: vendor, reason: reason }
      end
      claimed = entries.filter_map { |e| e[:vendor]&.id }.to_set

      counts = { rows: entries.size, created: 0, updated: 0, unchanged: 0, issues: 0 }
      Vendor.transaction do
        ImportIssue.open.where(kind: "vendor_details", filename: @filename)
                   .update_all(status: "resolved", resolution: "reimported", resolved_by_id: @user&.id, resolved_at: Time.current,
                               updated_at: Time.current)
        entries.each do |e|
          vendor, reason = e[:vendor], e[:reason]
          similar = nil
          if vendor.nil? && reason.nil?
            vendor = @by_name[self.class.normalize_name(e[:name])].first # added by an earlier row of this file
            similar = possible_duplicates(e[:name], e[:code], claimed)
            if vendor.nil? && @kind == :details && similar.empty?
              vendor = Vendor.new(name: e[:name].squish.first(200))
            elsif vendor.nil?
              reason = similar.any? && @kind == :details ? "Possible duplicate of #{similar.map(&:name).join(' or ')}" :
                                                           "No vendor with this name or GSTIN (import the vendor details file first)"
            end
          end
          attributes = @kind == :details ? details(e[:cell], e[:code], e[:name], e[:gst]) : { tax_officer_address: e[:cell].("administrative office") }
          if vendor.nil?
            # Look-alikes, or the vendors the name matches several of.
            record_issue(e, reason, attributes, similar.presence || @by_name[self.class.normalize_name(e[:name])])
            counts[:issues] += 1
            next
          end

          vendor.assign_attributes(attributes)
          if vendor.new_record?
            vendor.save!
            remember(vendor)
            counts[:created] += 1
          elsif vendor.changed?
            vendor.save!
            counts[:updated] += 1
          else
            counts[:unchanged] += 1
          end
        end
      end
      Result.new(kind: @kind.to_s, **counts)
    rescue ActiveRecord::RecordInvalid => e
      raise InvalidFile, "Row for #{e.record.name}: #{e.record.errors.full_messages.to_sentence}. Nothing was imported."
    end

    private

    # A row not saved, for the Import issues tab: its details (`attributes`, applied when it is linked to a vendor or
    # added) and the look-alike vendors (`candidate_ids`, offered first when linking).
    def record_issue(entry, reason, attributes, similar)
      ImportIssue.create!(
        filename: @filename, excel_row: entry[:row], kind: "vendor_details", message: reason.first(255), imported_by: @user,
        row_data: { "source" => @kind.to_s, "vendor_name" => entry[:name], "vendor_code" => entry[:code],
                    "attributes" => attributes.transform_values { |v| v.is_a?(BigDecimal) ? v.to_s("F") : v },
                    "candidate_ids" => similar.map(&:id) }
      )
    end

    # Lookups of the vendors in the app (before this import, plus the ones it adds).
    def index_vendors
      vendors = Vendor.all.to_a
      @existing_key_words = vendors.flat_map { |v| [ v.name, v.company_name ].compact.map { |n| [ self.class.key_word(n), v ] } }
                                   .select(&:first).group_by(&:first).transform_values { |list| list.map(&:last).uniq }
      @by_code, @by_name, @by_gst, @by_email = {}, Hash.new { |h, k| h[k] = [] }, Hash.new { |h, k| h[k] = [] }, Hash.new { |h, k| h[k] = [] }
      vendors.each { |v| remember(v) }
    end

    def remember(vendor)
      @by_code[vendor.code.upcase] = vendor if vendor.code
      [ vendor.name, vendor.company_name ].compact.map { |n| self.class.normalize_name(n) }.uniq.each { |n| @by_name[n] |= [ vendor ] }
      @by_gst[vendor.gst] |= [ vendor ] if vendor.gst
      emails(vendor.email).to_s.split(", ").each { |e| @by_email[e.downcase] |= [ vendor ] }
    end

    # [vendor, nil] when found; [nil, reason] when the row must not be saved; [nil, nil] when no vendor matches.
    def find_vendor(code, name, gst, email_list)
      return [ @by_code[code], nil ] if code && @by_code[code]

      by_name = @by_name[self.class.normalize_name(name)]
      return [ by_name.first, nil ] if by_name.size == 1
      return [ nil, "Matches #{by_name.size} vendors by name: #{by_name.map(&:name).join(' and ')}" ] if by_name.size > 1

      return [ @by_gst[gst].first, nil ] if gst&.match?(GSTIN) && @by_gst[gst].size == 1

      by_email = email_list.to_s.split(", ").flat_map { |e| @by_email[e.downcase] }.uniq
      return [ by_email.first, nil ] if by_email.size == 1

      [ nil, nil ]
    end

    # Vendors already in the app whose name shares its key word with `name` ("Globe Rectifiers" for "Globe Electro
    # Forge"), unless another row of the file matches them or they have another Vendor Code: then they are a
    # different company.
    def possible_duplicates(name, code, claimed)
      (@existing_key_words[self.class.key_word(name)] || []).reject { |v| claimed.include?(v.id) || (v.code && v.code != code) }
    end

    # The header row (within the first 10 rows) and its columns: lower-cased header => column number.
    def find_header
      (@sheet.first_row.to_i..[ @sheet.first_row.to_i + 9, @sheet.last_row.to_i ].min).each do |r|
        columns = (@sheet.first_column.to_i..@sheet.last_column.to_i).each_with_object({}) do |c, h|
          header = clean(@sheet.cell(r, c))&.downcase
          h[header] = c if header
        end
        next if columns.key?("part number") || columns.key?("customer part") # a DTP Details file (Vendors::Importer)
        return [ r, columns ] if columns.key?("vendor name") && (columns.key?("vendor code") || columns.key?("administrative office"))
      end
      raise InvalidFile, "This is not the vendor details file (Vendor Code, Vendor Name, …) or the tax officer file " \
                         "(Vendor Name, Administrative Office)."
    end

    # Fields from one row of the vendor master file. Blank or "N/A" cells leave the vendor's value as it is.
    def details(cell, code, name, gst)
      valid_gst = gst if gst&.match?(GSTIN)
      status = cell.("gst status").to_s
      attrs = {
        code: code, company_name: name,
        address: [ cell.("address 1"), cell.("address 2") ].compact.join("\n").presence,
        phone: cell.("contactno"), email: emails(cell.("email id")),
        lead_days: cell.("lead days")&.then { |v| Integer(v.to_f.round, exception: false) },
        payment_terms: (cell.("payment terms") unless cell.("payment terms")&.casecmp?("N/A")),
        gst: valid_gst, pan: valid_gst&.slice(2, 10), place_of_supply: valid_gst && STATES[valid_gst[0, 2]],
        gst_treatment: if valid_gst then "registered_regular"
                       elsif gst.to_s.start_with?("UNREG") then "unregistered"
                       elsif gst == "N/A" then "overseas"
                       end,
        gst_rate: status[/(\d+(?:\.\d+)?)\s*%/, 1]&.to_d
      }.merge(contact(cell.("contact name")))
      attrs.compact
    end

    # "Mr. Amarjit singh" => salutation Mr., first name Amarjit, last name singh. Several people stay in the first name.
    def contact(text)
      return {} if text.nil?

      salutation = Vendor::SALUTATIONS.find { |s| text.match?(/\A#{Regexp.escape(s.delete('.'))}\.?\s/i) }
      rest = salutation ? text.sub(/\A\S+\s+/, "") : text
      words = rest.split
      first, last = words.size == 2 ? words : [ rest, nil ]
      { salutation: salutation, first_name: first&.first(100), last_name: last&.first(100) }
    end

    # "a@x.com; 'Neeraj' b@y.com" => "a@x.com, b@y.com" (only the addresses).
    def emails(text)
      list = text.to_s.scan(/[^\s@,;'<>"&]+@[^\s@,;'<>"&]+\.[A-Za-z]{2,}/).uniq
      list.join(", ").presence
    end

    def clean(value)
      text = value.is_a?(Float) && value == value.floor ? value.to_i.to_s : value.to_s
      text = text.strip
      text.empty? || text == "-" ? nil : text
    end
  end
end
