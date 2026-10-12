# A delivery reported on an order by the Warehouse Manager: inbound (received at SASH US) or outbound (delivered
# to Deere). Keyed like vendor order placements (PO + Part + Type + PO Line + Ship Date, or the manual order), so
# the mark stays on the order in later uploads. Removing (admin only) keeps the record with removed_at/by.
class OrderDelivery < ApplicationRecord
  KINDS = %w[inbound outbound].freeze
  LABELS = { "inbound" => "Delivered to SASH US", "outbound" => "Delivered to Deere" }.freeze

  belongs_to :order_row, optional: true
  belongs_to :manual_order, optional: true
  belongs_to :marked_by, class_name: "User"
  belongs_to :removed_by, class_name: "User", optional: true

  validates :kind, inclusion: { in: KINDS }
  validates :note, length: { maximum: 500 }

  scope :active, -> { where(removed_at: nil) }

  def label
    LABELS.fetch(kind)
  end
end
