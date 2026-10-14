# Status of an order along its route, one mark per step and order:
#   received    received at SASH Faridabad          (SASH India / admin)
#   dispatched  dispatched from SASH Faridabad       (admin; with the SASH India invoice number)
#   inbound     received at SASH US                  (Warehouse Manager)
#   outbound    delivered to Deere (fulfilled)       (Warehouse Manager)
# Keyed like vendor order placements (PO + Part + Type + PO Line + Ship Date, or the manual order), so the mark
# stays on the order in later uploads. Removing (admin only) keeps the record with removed_at/by.
class OrderDelivery < ApplicationRecord
  KINDS = %w[received dispatched inbound outbound].freeze
  LABELS = {
    "received" => "Received at SASH Faridabad", "dispatched" => "Dispatched from SASH Faridabad",
    "inbound" => "Delivered to SASH US", "outbound" => "Delivered to Deere"
  }.freeze
  # Which statuses each role sets.
  ROLE_KINDS = { "admin" => %w[received dispatched], "warehouse_manager" => %w[inbound outbound] }.freeze

  belongs_to :order_row, optional: true
  belongs_to :manual_order, optional: true
  belongs_to :marked_by, class_name: "User"
  belongs_to :removed_by, class_name: "User", optional: true

  validates :kind, inclusion: { in: KINDS }
  validates :note, length: { maximum: 500 }
  validates :invoice_number, presence: true, length: { maximum: 64 }, if: -> { kind == "dispatched" }

  scope :active, -> { where(removed_at: nil) }

  # The step that must be recorded before this one (statuses go in route order), or nil for the first.
  def self.previous_kind(kind)
    index = KINDS.index(kind)
    index&.positive? ? KINDS[index - 1] : nil
  end

  def label
    LABELS.fetch(kind)
  end
end
