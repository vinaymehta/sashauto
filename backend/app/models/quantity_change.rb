# A detected quantity change between this version and the previous one, per PO Number + PO Line Number + Part
# Number + Ship Date (rows of the same key added up): a key in both with a different Qty (increase/decrease), one
# only in this version (added, old Qty 0) or only in the previous one (removed, new Qty 0). Manual order edits are
# per order. A quantity moved to another Ship Date of the same PO line is one "rescheduled" change (previous_ship_date).
# Immutable (enforced by a DB trigger).
class QuantityChange < ApplicationRecord
  DIRECTIONS = %w[increase decrease added removed rescheduled].freeze

  # Upload-detected changes reference both uploads; changes from a manual order edit reference the order.
  belongs_to :upload_batch, optional: true
  belongs_to :previous_upload_batch, class_name: "UploadBatch", optional: true
  belongs_to :manual_order, optional: true
  # Changes detected since the PO + Part + Type model reference order rows; older ones snapshot rows.
  belongs_to :order_snapshot_row, optional: true
  belongs_to :previous_order_snapshot_row, class_name: "OrderSnapshotRow", optional: true
  belongs_to :order_row, optional: true
  belongs_to :previous_order_row, class_name: "OrderRow", optional: true

  def readonly?
    persisted?
  end
end
