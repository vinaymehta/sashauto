# A problem found while importing a vendor workbook: a skipped row or a value that could not be read. Holds the
# Excel row (`row_data`, by importer field) so an admin can fix and add it, dismiss it, or delete what it created.
class ImportIssue < ApplicationRecord
  KINDS = %w[skipped unreadable].freeze
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
