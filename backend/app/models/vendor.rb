# A supplier. Its parts (with vendor part number, MOQ, weight and price) are VendorProducts.
class Vendor < ApplicationRecord
  has_many :vendor_products, dependent: :delete_all
  has_many :products, through: :vendor_products

  normalizes :name, with: ->(value) { value.to_s.squish }

  validates :name, presence: true, length: { maximum: 200 }, uniqueness: { case_sensitive: false }
end
