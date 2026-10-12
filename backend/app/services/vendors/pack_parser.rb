module Vendors
  # Reads how a part is packed, and its MOQ and price per piece and per set, from a vendor workbook row.
  #
  #   pack size  "of 10 pcs" in the MOQ, "Pack of 10 Pcs" / "(10)NUT" / "Kit Bush (8)" in the description, or the
  #              ratio of the set price to the piece price; otherwise 1 (sold as single pieces).
  #   MOQ        "2000 pcs (200 of 10 pcs)" → 2000 pcs, 200 sets; "300 of 10 pcs" / "100 sets of 2 pcs" /
  #              "250 pcs of 10" → 300 / 100 / 250 sets; "200 pcs" → 200 pcs; a bare number is sets.
  #   price      "₹12 per pc (₹60 per Set)" → both; "₹83 per Set" → per set; "₹80 per pcs" → per piece; a bare amount
  #              ("4.25", "GBP 4.04", "$1.5 EX CHINA") is the price of one set.
  # Whichever unit is missing is derived with the pack size.
  module PackParser
    module_function

    NUMBER = /\d[\d,]*(?:\.\d+)?/
    CURRENCY = /(\$|€|₹|¥|£|USD|EUR|INR|CNY|RMB|GBP|RS\.?)/i
    PIECES = /(?:pcs|pc|pec|pieces|piece|nos)\b\.?/i
    SETS = /(?:sets?|packs?|kits?)\b/i
    PRICE_PART = /#{CURRENCY}?\s*(#{NUMBER})\s*(?:\/|per)\s*(#{PIECES}|#{SETS})/i

    Moq = Data.define(:pcs, :sets)
    Price = Data.define(:pc, :set, :currency, :note)

    # Whitespace collapsed (cells hold non-breaking spaces), "9. 4" typed for "9.4" mended.
    def text(value)
      value.to_s.gsub(/[[:space:]]+/, " ").strip.gsub(/(\d)\. (\d)/, '\1.\2')
    end

    def num(string)
      string.to_s.delete(",").to_d
    end

    # Pieces in one set, from the MOQ, the description or the two prices; 1 when nothing says so.
    def pack_size(description: nil, moq: nil, price: nil)
      moq_text = text(moq)
      if (m = moq_text.match(/of\s+(\d+)\s*(?:#{PIECES})?\s*\)?\s*\z/i) || moq_text.match(/of\s+(\d+)\s*#{PIECES}/i))
        return m[1].to_i if m[1].to_i >= 1
      end
      desc = text(description)
      [ /pack\s*of\s*(\d{1,4})/i, /\A\(\s*(\d{1,4})\s*\)/, /\(\s*(\d{1,4})\s*\)/ ].each do |pattern|
        m = desc.match(pattern)
        return m[1].to_i if m && m[1].to_i >= 1
      end
      prices = price_parts(price)
      if prices[:pc]&.positive? && prices[:set]&.positive?
        ratio = (prices[:set] / prices[:pc]).round
        return ratio if ratio >= 1 && (prices[:pc] * ratio - prices[:set]).abs <= prices[:set] * 0.02
      end
      1
    end

    # MOQ in pieces and sets, or nil when the text cannot be read.
    def moq(value, pack)
      return nil if value.nil? || text(value).empty?
      return Moq.new(pcs: value.to_d * pack, sets: value.to_d) if value.is_a?(Numeric)

      t = text(value)
      # "2000 pcs (200 of 10 pcs)", "1000 pcs or 250 packs of 4 pcs", "2050 pcs (205 sets of 10 pcs)"
      if (m = t.match(/\A(#{NUMBER})\s*#{PIECES}\s*(?:\(|or\b)\s*(#{NUMBER})\s*(?:#{SETS}|#{PIECES})?\s*of\b/i))
        return Moq.new(pcs: num(m[1]), sets: num(m[2]))
      end
      # "300 of 10 pcs", "100 sets of 2 pcs", "250 pcs of 10" — that many sets
      if (m = t.match(/\A(#{NUMBER})\s*(?:#{SETS}|#{PIECES})?\s*of\s*\d+/i))
        return Moq.new(pcs: num(m[1]) * pack, sets: num(m[1]))
      end
      # "200 pcs"
      if (m = t.match(/\A(#{NUMBER})\s*#{PIECES}\s*\z/i))
        return Moq.new(pcs: num(m[1]), sets: (num(m[1]) / pack).round(3))
      end
      # "200 sets"
      if (m = t.match(/\A(#{NUMBER})\s*#{SETS}\s*\z/i))
        return Moq.new(pcs: num(m[1]) * pack, sets: num(m[1]))
      end
      # a bare number written as text
      return Moq.new(pcs: num(t) * pack, sets: num(t)) if t.match?(/\A#{NUMBER}\z/)

      nil
    end

    # Price per piece and per set (one may be derived), currency, and any leftover text as a note.
    # Returns a Price with nil amounts when no amount can be read (the whole text becomes the note).
    def price(value, pack, currencies:)
      return Price.new(pc: nil, set: nil, currency: "INR", note: nil) if value.nil? || text(value).empty?
      return Price.new(pc: (value.to_d / pack).round(4), set: value.to_d, currency: "INR", note: nil) if value.is_a?(Numeric)

      t = text(value)
      # European style with the currency after the amount: "25,40€" → €25.40.
      if (m = t.match(/\A(\d+),(\d{1,2})\s*#{CURRENCY}\s*\z/i) || t.match(/\A(\d+)(?:\.(\d+))?\s*#{CURRENCY}\s*\z/i))
        set = "#{m[1]}.#{m[2] || 0}".to_d
        return Price.new(pc: (set / pack).round(4), set: set, currency: currencies.fetch(m[3].to_s.upcase, "INR"), note: nil)
      end
      parts = price_parts(t)
      currency = currencies.fetch(parts[:currency].to_s.upcase, "INR")
      if parts[:pc] || parts[:set]
        pc = parts[:pc] || (parts[:set] / pack).round(4)
        set = parts[:set] || parts[:pc] * pack
        return Price.new(pc: pc, set: set, currency: currency, note: nil)
      end
      # A bare amount ("4.25", "GBP 4.04", "$1.5 EX CHINA"): the price of one set.
      if (m = t.match(/\A#{CURRENCY}?\s*(#{NUMBER})\s*(.*)\z/i))
        set = num(m[2])
        return Price.new(pc: (set / pack).round(4), set: set, currency: currencies.fetch(m[1].to_s.upcase, "INR"), note: m[3].strip.presence)
      end
      Price.new(pc: nil, set: nil, currency: "INR", note: t.first(200))
    end

    # { pc:, set:, currency: } from "₹12 per pc (₹60 per Set)"-style text.
    def price_parts(value)
      result = { pc: nil, set: nil, currency: nil }
      text(value).scan(PRICE_PART) do |currency, amount, unit|
        key = unit.match?(SETS) ? :set : :pc
        result[key] ||= num(amount)
        result[:currency] ||= currency
      end
      result
    end
  end
end
