# An uploaded Commodity Type that disagrees with the product's recorded one.
class ProductConflict < ApplicationRecord
  RESOLUTIONS = %w[kept_existing accepted_incoming].freeze

  belongs_to :product
  belongs_to :upload_batch, optional: true
  belongs_to :resolved_by, class_name: "User", optional: true

  scope :open, -> { where(status: "open") }

  def open?
    status == "open"
  end
end
