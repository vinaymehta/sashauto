class Product < ApplicationRecord
  SOURCES = %w[upload manual].freeze

  belongs_to :created_by, class_name: "User", optional: true
  belongs_to :first_seen_upload_batch, class_name: "UploadBatch", optional: true
  has_many :product_conflicts

  normalizes :part_number, with: ->(value) { OrderRows::Normalizer.part_number(value) }
  normalizes :commodity_type, with: ->(value) { OrderRows::Normalizer.text(value) }

  PART_NUMBER_FORMAT = %r{\A[A-Z0-9][A-Z0-9 ._/\-]*\z}

  validates :part_number, presence: true, uniqueness: true, length: { maximum: 100 }
  # Checked only when the Part Number is set manually; uploaded Part Numbers are stored as the file has them.
  validates :part_number, format: { with: PART_NUMBER_FORMAT, message: "may contain only letters, digits, spaces and . _ / -" },
                          if: :will_save_change_to_part_number?
  validates :commodity_type, length: { maximum: 100 }
  validates :source, inclusion: { in: SOURCES }
  validates :moq, numericality: { greater_than: 0, less_than: 1_000_000_000_000 }, allow_nil: true
end
