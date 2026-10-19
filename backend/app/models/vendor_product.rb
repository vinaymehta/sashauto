# One part (Product / Part Number) supplied by one vendor, with that vendor's details for it.
class VendorProduct < ApplicationRecord
  include PackQuantities
  CURRENCIES = %w[INR USD EUR CNY GBP].freeze

  belongs_to :vendor, touch: true
  belongs_to :product
  # Who last ticked or unticked "Available" (the vendor can supply this part now).
  belongs_to :available_changed_by, class_name: "User", optional: true

  # "Available Parts": pieces the vendor has available now.
  validates :available_qty, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  blank_to_nil = ->(value) { value.to_s.strip.presence }
  normalizes :sash_part, :vendor_part, :description, :price_note, with: blank_to_nil
  normalizes :price_currency, with: ->(value) { value.to_s.strip.upcase }

  validates :product_id, uniqueness: { scope: :vendor_id, message: "is already listed for this vendor" }
  validates :sash_part, :vendor_part, length: { maximum: 100 }
  validates :description, length: { maximum: 1000 }
  validates :price_note, length: { maximum: 200 }
  validates :moq, numericality: { greater_than: 0, less_than: 1_000_000_000_000 }, allow_nil: true
  validates :weight_kg, numericality: { greater_than_or_equal_to: 0, less_than: 100_000_000 }, allow_nil: true
  validates :price_amount, :set_price_amount, numericality: { greater_than_or_equal_to: 0, less_than: 100_000_000_000 }, allow_nil: true
  validates :price_currency, inclusion: { in: CURRENCIES }

  # Price history: every change of the vendor's price is kept as a PriceChange. Callers say where it came from.
  attr_accessor :price_source, :price_changed_by
  after_save :record_price_change, if: -> { saved_change_to_price_amount? || saved_change_to_set_price_amount? || saved_change_to_price_currency? }

  private

  def record_price_change
    PriceChange.create!(
      product_id: product_id, vendor_product: self, kind: "vendor", vendor_name: vendor.name,
      old_amount: price_amount_before_last_save, new_amount: price_amount,
      old_set_amount: set_price_amount_before_last_save, new_set_amount: set_price_amount,
      currency: price_currency, source: price_source || "manual", changed_by: price_changed_by
    )
  end
end
