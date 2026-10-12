# Parts sold in sets/packs: `pack_size` pieces per set, MOQ in pieces (`moq`) and sets (`moq_sets`), and — on vendor
# parts — the price per piece (`price_amount`) and per set (`set_price_amount`). Whichever side was set is the source
# and the other is derived with the pack size; when both are set the set value wins (order Qty counts sets).
module PackQuantities
  extend ActiveSupport::Concern

  included do
    before_validation :derive_pack_quantities
    validates :pack_size, numericality: { only_integer: true, greater_than_or_equal_to: 1, less_than: 100_000 }
    validates :moq_sets, numericality: { greater_than: 0, less_than: 1_000_000_000_000 }, allow_nil: true
  end

  private

  def derive_pack_quantities
    pack = [ pack_size.to_i, 1 ].max
    if moq_sets_changed? || (pack_size_changed? && !moq_sets.nil?)
      self.moq = moq_sets && (moq_sets * pack)
    elsif moq_changed?
      self.moq_sets = moq && (moq / pack).round(3)
    end
    # The file's own text ("200 of 10 pcs") no longer matches once the numbers are edited by hand.
    self.moq_text = nil if (moq_changed? || moq_sets_changed?) && !moq_text_changed?
    return unless has_attribute?(:set_price_amount)

    if set_price_amount_changed? || (pack_size_changed? && !set_price_amount.nil?)
      self.price_amount = set_price_amount && (set_price_amount / pack).round(4)
    elsif price_amount_changed?
      self.set_price_amount = price_amount && (price_amount * pack)
    end
    self.price_text = nil if (price_amount_changed? || set_price_amount_changed? || price_currency_changed?) && !price_text_changed?
  end
end
