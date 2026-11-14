module VendorOrders
  # The vendor of a name in an uploaded file (vendor PO list, Purchase Received): the same name without case,
  # punctuation and words like Ltd / Pvt (several: the one spelt the same, else the oldest), else the one vendor whose
  # name starts with it (or it with theirs). When that is not clear (no vendor, or several, e.g. "Polestar" for
  # "Polestar Engineers" and "Polestar Enggineers"), the vendors linked to the row's part in Products decide: the one
  # among them whose name shares its first word with the file's (or starts with it). nil when none.
  class VendorMatch
    # Words left out when comparing vendor names ("Stonkam Co., Ltd" = "Stonkam Co. Ltd").
    NAME_NOISE = %w[ltd limited pvt private co company inc llp corp corporation the and].freeze

    def self.normalize(name)
      name.to_s.downcase.gsub("&", " and ").scan(/[a-z0-9]+/).reject { |w| NAME_NOISE.include?(w) }.join(" ")
    end

    def initialize
      @vendors = Vendor.order(:id).to_a.map { |v| [ self.class.normalize(v.name), v ] }
    end

    def find(name, part_number: nil)
      wanted = self.class.normalize(name)
      return nil if wanted.empty?

      exact = @vendors.select { |n, _| n == wanted }
      return (exact.find { |_, v| v.name.casecmp?(name.to_s.strip) } || exact.first).last if exact.any?

      near = @vendors.select { |n, _| !n.empty? && (n.start_with?(wanted) || wanted.start_with?(n)) }
      return near.first.last if near.one?

      linked(wanted, part_number)
    end

    # The part's vendors (Products) that a cell names, by the start of their name (its first word, or first two when
    # short: "aayess", "gbingeneure", "apls"), in the order the part lists them. Several mean the row is for each.
    def named_in(cell, part_number:)
      return [] if part_number.blank?

      text = self.class.normalize(cell).delete(" ")
      Vendor.joins(vendor_products: :product).where(products: { part_number: part_number }).distinct.order(:id).select do |v|
        words = self.class.normalize(v.name).split
        key = words.first.to_s.length >= 4 ? words.first : words.first(2).join
        key.length >= 4 && text.include?(key)
      end
    end

    private

    # The part's vendor (Products → its vendors) the file's name points to: the same first word, or one name starting
    # with the other, when exactly one of the part's vendors fits; else the part's only vendor when the two names start
    # with the same 4 letters, or when the file's name is no vendor's.
    def linked(wanted, part_number)
      return nil if part_number.blank?

      vendors = Vendor.joins(vendor_products: :product).where(products: { part_number: part_number }).distinct.to_a
      first = wanted.split.first
      fits = vendors.select do |v|
        n = self.class.normalize(v.name)
        n.split.first == first || n.delete(" ").start_with?(wanted.delete(" ")) || wanted.delete(" ").start_with?(n.delete(" "))
      end
      return fits.first if fits.one?

      # The part has one vendor: it, when the names start alike ("Forgetech" for "Forge Teck Engineering") or the file's
      # name is no vendor at all (a trading name on the invoice: "Hanphin Technology" for Hangzhou Holdwell's part).
      only = vendors.one? ? vendors.first : nil
      return nil unless only

      alike = self.class.normalize(only.name).delete(" ").first(4) == wanted.delete(" ").first(4)
      alike || @vendors.none? { |n, _| n.split.first == wanted.split.first } ? only : nil
    end
  end
end
