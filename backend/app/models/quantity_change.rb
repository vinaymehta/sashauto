# A detected quantity change for an order row that exists in both this version and the previous one.
# Immutable (enforced by a DB trigger).
class QuantityChange < ApplicationRecord
  DIRECTIONS = %w[increase decrease].freeze

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
