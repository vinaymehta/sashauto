# A supplier. Its parts (with vendor part number, MOQ, weight and price) are VendorProducts.
class Vendor < ApplicationRecord
  has_many :vendor_products, dependent: :delete_all
  has_many :products, through: :vendor_products
  has_many :vendor_orders, dependent: :restrict_with_error

  normalizes :name, with: ->(value) { value.to_s.squish }
  normalizes :email, with: ->(value) { value.to_s.strip.downcase.presence }
  normalizes :address, with: ->(value) { value.to_s.strip.presence }
  normalizes :gst, with: ->(value) { value.to_s.strip.upcase.presence }
  normalizes :phone, with: ->(value) { value.to_s.squish.presence }

  validates :name, presence: true, length: { maximum: 200 }, uniqueness: { case_sensitive: false }
  # Where this vendor's order emails are sent.
  validates :email, length: { maximum: 254 }, format: { with: URI::MailTo::EMAIL_REGEXP, message: "is not a valid email address" },
                    allow_nil: true
  validates :address, length: { maximum: 1000 }
  validates :gst, length: { maximum: 32 } # GSTIN for Indian vendors; vendors abroad may leave it blank
  validates :phone, length: { maximum: 40 }, format: { with: /\A[+\d][\d\s\-()]{5,}\z/, message: "is not a valid phone number" }, allow_nil: true
end
