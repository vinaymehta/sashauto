# One change of a part's price, kept as its price history:
#   customer  the customer's (Deere) Unit Price from the order file, per 100 pcs — from an upload or edited by hand
#   vendor    a vendor's price for the part (per piece and per set) — from a vendor file import or edited by hand
class PriceChange < ApplicationRecord
  KINDS = %w[customer vendor].freeze
  SOURCES = %w[upload manual import].freeze

  belongs_to :product
  belongs_to :vendor_product, optional: true
  belongs_to :upload_batch, optional: true
  belongs_to :changed_by, class_name: "User", optional: true

  validates :kind, inclusion: { in: KINDS }
  validates :source, inclusion: { in: SOURCES }
end
