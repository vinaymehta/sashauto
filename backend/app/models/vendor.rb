# A supplier. Its parts (with vendor part number, MOQ, weight and price) are VendorProducts.
class Vendor < ApplicationRecord
  has_many :vendor_products, dependent: :delete_all
  has_many :products, through: :vendor_products
  has_many :vendor_orders, dependent: :restrict_with_error

  normalizes :name, with: ->(value) { value.to_s.squish }
  normalizes :email, with: ->(value) { value.to_s.strip.downcase.presence }

  validates :name, presence: true, length: { maximum: 200 }, uniqueness: { case_sensitive: false }
  # Where this vendor's order emails are sent.
  validates :email, length: { maximum: 254 }, format: { with: URI::MailTo::EMAIL_REGEXP, message: "is not a valid email address" },
                    allow_nil: true
end
