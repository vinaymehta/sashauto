module Vendors
  # The Vendor Name cell of a product file, which can name several vendors: the part is then made by each of them.
  #   * with their prices: "APLS @ 150/- RAJPAL AGRO @ 60 for RM …, Jai Bharat Industries - Machining Jobwork 40",
  #     "For Pulley to Hurliman @ Rs 330 & for Spacer to Autovation for Rs 40.00";
  #   * joined names: "Amar Metal Works & S.B. Auto Industries" (each at the row's price), when each is a known vendor.
  # Each vendor of such a cell is matched to an existing vendor when its name is close enough (typos and words such as
  # "Industries", "Pvt. Ltd.", "Casting" ignored: "APLS Autotmotive industries" is "Apls Automotive Industries P.L.",
  # "AAYESS Casting" is "Aay Ess Castings"); otherwise it is a new vendor. A cell naming one vendor is that vendor.
  #
  #   VendorCell.new(Vendor.all).parse("APLS @ 290/- and Forgeteck @ 235/-")
  #   # => [Entry(name: "Apls Automotive Industries P.L.", vendor: <Vendor>, price: "Rs 290"), Entry(name: "Forge Teck…", …)]
  class VendorCell
    # vendor: the existing Vendor, or nil (a new vendor named `name`); price: the vendor's price text, or nil (the row's).
    Entry = Data.define(:name, :vendor, :price)

    # Words left out when comparing names.
    STOP_WORDS = %w[industries industry pvt private limited ltd pl p l co company engg engineering engineers works work casting castings cating
                    steel rolling mills tech international enterprises enterprise parts jobwork job machining mc m c llp inc corp the].to_set.freeze
    # A price in the cell: "@ Rs 2750", "@ 550/-", "@ 9.50", "for Rs 40.00".
    PRICE = /(?:@|\bfor\s+(?=rs\b))\s*(?:rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:\/-)?/i

    def initialize(vendors)
      @vendors = vendors.to_a
    end

    def parse(cell)
      name = cell.to_s.squish
      exact = @vendors.find { |v| v.name.casecmp?(name) }
      return [ Entry.new(name: exact.name, vendor: exact, price: nil) ] if exact
      return priced(name) if name.match?(PRICE)

      parts = name.split(/\s*(?:&|\+|,|\band\b)\s*/i).map(&:squish).reject(&:empty?)
      if parts.size > 1
        matched = parts.map { |part| match(part) }
        return matched.uniq.map { |v| Entry.new(name: v.name, vendor: v, price: nil) } if matched.all?
      end
      [ Entry.new(name: name, vendor: nil, price: nil) ]
    end

    private

    # The vendors of a cell with prices, each with the price after its name; a vendor named twice keeps its first price.
    def priced(cell)
      entries = []
      last = 0
      cell.to_enum(:scan, PRICE).map { Regexp.last_match }.each do |m|
        per_set = cell[m.end(0)..][/\A\s*per\s+set\b/i] # "@ Rs 6000 per set": part of the price, not of the next name
        add(entries, clean(cell[last...m.begin(0)]), "Rs #{m[1].delete(',')}#{' per set' if per_set}")
        last = m.end(0) + per_set.to_s.length
      end
      # After the last price: what it is for, then vendors written "Name - work 40" ("Jai Bharat Industries - Jobwork 40").
      cell[last..].to_s.split(/\s*,\s*/).drop(1).each do |piece|
        m = piece.match(/\A(.+?)\s+(\d+(?:\.\d+)?)\s*(?:\/-)?\z/)
        add(entries, clean(m[1]), "Rs #{m[2]}") if m
      end
      entries
    end

    def add(entries, label, price)
      return if label.empty? || label.match?(/\A\d/) # "200 nuts @ 2.50": a second price of the vendor before

      vendor = match(label)
      same = entries.any? { |e| vendor ? e.vendor == vendor : e.vendor.nil? && key(e.name) == key(label) }
      entries << Entry.new(name: vendor&.name || label, vendor: vendor, price: price) unless same
    end

    # The vendor's name in a piece of the cell: "SASH to APLS" → APLS, "for Pulley to Hurliman" → Hurliman,
    # "AAYESS for 100 pcs" → AAYESS, "Shyam Sons (Bolt" → Shyam Sons, "Jai Bharat Industries - Jobwork" → Jai Bharat Industries.
    def clean(text)
      t = text.to_s.sub(/\(.*\z/m, "").delete("()")
      t = t.sub(/\A[\s,&+\-]*(?:and\s+)?/i, "").sub(/\Asash\s+to\s+/i, "").sub(/\Afor\s+.+?\s+to\s+/i, "")
      t = t.split(/\s+for\s+/i).first.to_s.split(/\s+-\s+/).first.to_s
      t.squish.sub(/[\s,&+\-]+\z/, "")
    end

    # The existing vendor a name means: the same name without suffix words, one starting like it, or one a typo away.
    def match(label)
      k = key(label)
      return nil if k.length < 3

      named = @vendors.map { |v| [ v, key(v.name) ] }.reject { |_, vk| vk.empty? }
      found = named.select { |_, vk| vk == k }
      found = named.select { |_, vk| [ vk.length, k.length ].min >= 4 && (vk.start_with?(k) || k.start_with?(vk)) } if found.empty?
      found = named.select { |_, vk| k.length >= 6 && levenshtein(vk, k) <= 2 } if found.empty?
      found.min_by { |v, vk| [ vk.length, v.id.to_i ] }&.first
    end

    def key(name)
      name.to_s.downcase.split(/[^a-z0-9]+/).reject { |w| w.empty? || STOP_WORDS.include?(w) }.join
    end

    def levenshtein(a, b)
      row = (0..b.length).to_a
      a.each_char.with_index(1) do |ca, i|
        prev, row[0] = row[0], i
        b.each_char.with_index(1) do |cb, j|
          prev, row[j] = row[j], [ row[j] + 1, row[j - 1] + 1, prev + (ca == cb ? 0 : 1) ].min
        end
      end
      row[b.length]
    end
  end
end
