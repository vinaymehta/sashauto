# A changed Ship To Address on a current order row between two uploads. Immutable.
class AddressChange < ApplicationRecord
  belongs_to :upload_batch
  belongs_to :previous_upload_batch, class_name: "UploadBatch"
  belongs_to :order_row
  belongs_to :previous_order_row, class_name: "OrderRow"

  def readonly?
    persisted?
  end
end
