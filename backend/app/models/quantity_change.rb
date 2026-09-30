# A detected quantity change for an order row that exists in both this version and the previous one.
# Immutable (enforced by a DB trigger).
class QuantityChange < ApplicationRecord
  DIRECTIONS = %w[increase decrease].freeze

  belongs_to :upload_batch
  belongs_to :previous_upload_batch, class_name: "UploadBatch"
  belongs_to :order_snapshot_row
  belongs_to :previous_order_snapshot_row, class_name: "OrderSnapshotRow"

  def readonly?
    persisted?
  end
end
