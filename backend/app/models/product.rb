class Product < ApplicationRecord
  include PackQuantities
  SOURCES = %w[upload manual].freeze

  belongs_to :created_by, class_name: "User", optional: true
  belongs_to :first_seen_upload_batch, class_name: "UploadBatch", optional: true
  has_many :product_conflicts
  has_many :vendor_products, dependent: :restrict_with_error
  has_many :price_changes

  # Price history: every change of the customer price (Unit Price per 100 pcs) is kept as a PriceChange.
  attr_accessor :price_source, :price_changed_by, :price_upload_batch
  after_save :record_customer_price_change, if: :saved_change_to_customer_price?

  normalizes :part_number, with: ->(value) { OrderRows::Normalizer.part_number(value) }
  normalizes :commodity_type, with: ->(value) { OrderRows::Normalizer.text(value) }

  PART_NUMBER_FORMAT = %r{\A[A-Z0-9][A-Z0-9 ._/\-]*\z}

  validates :part_number, presence: true, uniqueness: true, length: { maximum: 100 }
  # Checked only when the Part Number is set manually; uploaded Part Numbers are stored as the file has them.
  validates :part_number, format: { with: PART_NUMBER_FORMAT, message: "may contain only letters, digits, spaces and . _ / -" },
                          if: :will_save_change_to_part_number?
  validates :commodity_type, length: { maximum: 100 }
  validates :source, inclusion: { in: SOURCES }
  validates :weight_kg, numericality: { greater_than_or_equal_to: 0, less_than: 100_000_000 }, allow_nil: true
  validates :sash_part, :vendor_part, length: { maximum: 100 }
  validates :description, length: { maximum: 1000 }
  validates :moq, numericality: { greater_than: 0, less_than: 1_000_000_000_000 }, allow_nil: true
  validates :customer_price, numericality: { greater_than_or_equal_to: 0, less_than: 100_000_000_000 }, allow_nil: true

  private

  def record_customer_price_change
    PriceChange.create!(product: self, kind: "customer", old_amount: customer_price_before_last_save, new_amount: customer_price,
                        source: price_source || "manual", changed_by: price_changed_by, upload_batch: price_upload_batch)
  end
end
