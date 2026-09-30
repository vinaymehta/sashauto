# One normalized order row inside one upload version. Immutable (enforced by a DB trigger).
class OrderSnapshotRow < ApplicationRecord
  belongs_to :upload_batch

  def readonly?
    persisted?
  end
end
