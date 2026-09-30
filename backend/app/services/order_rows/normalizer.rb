require "digest"
require "bigdecimal"

# Single source of truth for how raw Excel values become normalized order-row values.
module OrderRows
  module Normalizer
    ORDER_TYPES = %w[Order Forecast Firm].freeze
    KEY_SEPARATOR = "\u001F" # ASCII unit separator; cannot appear in normalized text values
    ISO_DATE = /\A\d{4}-\d{2}-\d{2}\z/
    QUANTITY_TEXT = /\A\d{1,3}(,\d{3})*(\.\d+)?\z|\A\d+(\.\d+)?\z/
    MAX_QUANTITY = BigDecimal("999999999999") # fits numeric(15,3)

    class InvalidValue < StandardError; end

    module_function

    # Trims, collapses internal whitespace, and turns whitespace-only cells (the export writes " ") into nil.
    def text(value)
      return nil if value.nil?
      str = value.is_a?(Float) && value == value.floor ? value.to_i.to_s : value.to_s
      str = str.gsub(/[[:space:]]+/, " ").strip
      str.empty? ? nil : str
    end

    def part_number(value)
      text(value)&.upcase
    end

    def ship_to_location(value)
      text(value)&.upcase
    end

    # Identifiers such as PO Number are stored as text; leading zeros are significant ("00010").
    def identifier(value)
      text(value)
    end

    def order_type(value)
      str = text(value)
      return nil if str.nil?
      ORDER_TYPES.find { |type| type.casecmp?(str) } || raise(InvalidValue, "must be one of #{ORDER_TYPES.join(', ')} (got \"#{str}\")")
    end

    # Accepts real Excel dates and ISO (YYYY-MM-DD) text only. Other text formats such as 03/04/2027
    # are rejected because day/month order differs between countries.
    def date(value)
      case value
      when nil then nil
      when DateTime, Time then value.to_date
      when Date then value
      else
        str = text(value)
        return nil if str.nil?
        raise InvalidValue, "must be an Excel date or YYYY-MM-DD (got \"#{str}\")" unless ISO_DATE.match?(str)
        Date.iso8601(str)
      end
    rescue Date::Error
      raise InvalidValue, "is not a valid calendar date (got \"#{value}\")"
    end

    def quantity(value)
      number =
        case value
        when nil then nil
        when Integer then BigDecimal(value)
        when Float
          raise InvalidValue, "is not a finite number" unless value.finite?
          BigDecimal(value.to_s)
        when BigDecimal then value
        else
          str = text(value)
          return nil if str.nil?
          raise InvalidValue, "must be a non-negative number (got \"#{str}\")" unless QUANTITY_TEXT.match?(str)
          BigDecimal(str.delete(","))
        end
      return nil if number.nil?
      raise InvalidValue, "must not be negative (got #{number.to_s('F')})" if number.negative?
      raise InvalidValue, "is too large (got #{number.to_s('F')})" if number > MAX_QUANTITY
      raise InvalidValue, "has more than 3 decimal places" if number.round(3) != number
      number
    end

    # Business rule: Qty when present, otherwise Previous Qty, otherwise unknown (never assumed to be zero).
    # Returns [effective_qty, source].
    def effective_quantity(qty, previous_qty)
      return [ qty, "qty" ] unless qty.nil?
      return [ previous_qty, "previous_qty" ] unless previous_qty.nil?
      [ nil, "unknown" ]
    end

    # Business key: Ship To Location + Type + PO Number + PO Line Number + Part Number + Ship Date.
    def business_key_hash(ship_to_location:, order_type:, po_number:, po_line_number:, part_number:, ship_date:)
      parts = [ ship_to_location, order_type, po_number, po_line_number, part_number, ship_date.iso8601 ]
      Digest::SHA256.hexdigest(parts.join(KEY_SEPARATOR))
    end
  end
end
