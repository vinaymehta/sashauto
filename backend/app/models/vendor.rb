# A supplier. Its parts (with vendor part number, MOQ, weight and price) are VendorProducts. `name` is the display
# name used across the app (and matched by the price imports); `company_name` is the legal name from the vendor
# master file. `code` (e.g. "GR") is the supplier acronym in PO numbers.
class Vendor < ApplicationRecord
  TYPES = %w[business individual].freeze
  SALUTATIONS = %w[Mr. Mrs. Ms. Miss Dr.].freeze
  GST_TREATMENTS = %w[registered_regular registered_composition unregistered consumer overseas sez deemed_export].freeze
  TAX_PREFERENCES = %w[taxable tax_exempt].freeze
  CURRENCIES = %w[INR USD EUR CNY GBP].freeze
  # The concessional GST rate (goods for export): only these vendors get an Intimation Letter with their PO.
  LETTER_GST_RATE = BigDecimal("0.1")
  # One email, or several separated by commas or semicolons.
  EMAIL_LIST = /\A\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+(\s*[,;]\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+)*\s*[,;]?\s*\z/

  has_many :vendor_products, dependent: :delete_all
  has_many :products, through: :vendor_products
  has_many :vendor_orders, dependent: :restrict_with_error

  normalizes :name, with: ->(value) { value.to_s.squish }
  normalizes :email, with: ->(value) { value.to_s.strip.downcase.presence }
  normalizes :address, :tax_officer_address, :remarks, with: ->(value) { value.to_s.strip.presence }
  normalizes :gst, :pan, with: ->(value) { value.to_s.strip.upcase.presence }
  normalizes :code, with: ->(value) { value.to_s.strip.upcase.presence }
  normalizes :phone, :mobile, :first_name, :last_name, :company_name, :payment_terms, :place_of_supply, :salutation,
             with: ->(value) { value.to_s.squish.presence }

  validates :name, presence: true, length: { maximum: 200 }, uniqueness: { case_sensitive: false }
  validates :code, length: { maximum: 20 }, format: { with: /\A[A-Z0-9]+\z/, message: "can only use letters and digits" },
                   uniqueness: { case_sensitive: false }, allow_nil: true
  validates :email, length: { maximum: 500 }, format: { with: EMAIL_LIST, message: "is not a valid email address (separate several with commas)" },
                    allow_nil: true
  validates :address, :tax_officer_address, length: { maximum: 1000 }
  validates :remarks, length: { maximum: 2000 }
  validates :gst, length: { maximum: 32 } # GSTIN for Indian vendors; vendors abroad may leave it blank
  validates :pan, length: { maximum: 10 }
  validates :phone, :mobile, length: { maximum: 200 }
  validates :vendor_type, inclusion: { in: TYPES }
  validates :salutation, inclusion: { in: SALUTATIONS }, allow_nil: true
  validates :gst_treatment, inclusion: { in: GST_TREATMENTS }, allow_nil: true
  validates :tax_preference, inclusion: { in: TAX_PREFERENCES }
  validates :currency, inclusion: { in: CURRENCIES }
  validates :lead_days, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validates :gst_rate, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  # Primary contact, e.g. "Mr. Amarjit Singh".
  def contact_name
    [ salutation, first_name, last_name ].compact.join(" ").presence
  end

  # Supplies at the concessional GST rate of 0.1%, so its POs come with an Intimation Letter.
  def intimation_letter?
    gst_rate.present? && gst_rate.to_d == LETTER_GST_RATE
  end
end
