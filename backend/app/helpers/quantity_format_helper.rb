module QuantityFormatHelper
  def format_qty(value)
    return "—" if value.nil?
    number = value.to_d
    number_with_delimiter(number.frac.zero? ? number.to_i : number.to_s("F"))
  end

  def format_difference(value)
    value.positive? ? "+#{format_qty(value)}" : format_qty(value)
  end

  # Label of a quantity change's direction, e.g. in emails.
  CHANGE_LABELS = { "increase" => "↑ Up", "decrease" => "↓ Down", "added" => "Added", "removed" => "Removed" }.freeze

  def change_label(direction)
    CHANGE_LABELS.fetch(direction, direction)
  end
end
