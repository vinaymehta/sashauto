# A problem found while importing a vendor workbook: a skipped row or a value that could not be read (DTP Details,
# `row_data` by importer field: fix and add it, dismiss it, or delete what it created), or a row of the vendor details /
# tax officer file that matched no vendor or looked like a duplicate ("vendor_details", Vendors::DetailsImporter:
# link it to a vendor, add it as a new vendor, or dismiss it).
class ImportIssue < ApplicationRecord
  KINDS = %w[skipped unreadable vendor_details].freeze
  STATUSES = %w[open resolved dismissed].freeze

  belongs_to :product, optional: true
  belongs_to :vendor_product, optional: true
  belongs_to :imported_by, class_name: "User", optional: true
  belongs_to :resolved_by, class_name: "User", optional: true

  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }

  scope :open, -> { where(status: "open") }

  def close!(status, user:, resolution: nil)
    update!(status: status, resolution: resolution, resolved_by: user, resolved_at: Time.current)
  end
end
