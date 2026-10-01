# One part (Product / Part Number) supplied by one vendor, with that vendor's details for it.
class VendorProduct < ApplicationRecord
  CURRENCIES = %w[INR USD EUR CNY].freeze

  belongs_to :vendor, touch: true
  belongs_to :product

  blank_to_nil = ->(value) { value.to_s.strip.presence }
  normalizes :sash_part, :vendor_part, :description, :price_note, with: blank_to_nil
  normalizes :price_currency, with: ->(value) { value.to_s.strip.upcase }

  validates :product_id, uniqueness: { scope: :vendor_id, message: "is already listed for this vendor" }
  validates :sash_part, :vendor_part, length: { maximum: 100 }
  validates :description, length: { maximum: 1000 }
  validates :price_note, length: { maximum: 200 }
  validates :moq, numericality: { greater_than: 0, less_than: 1_000_000_000_000 }, allow_nil: true
  validates :weight_kg, numericality: { greater_than_or_equal_to: 0, less_than: 100_000_000 }, allow_nil: true
  validates :price_amount, numericality: { greater_than_or_equal_to: 0, less_than: 100_000_000_000 }, allow_nil: true
  validates :price_currency, inclusion: { in: CURRENCIES }
end
