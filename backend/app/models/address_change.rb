# A changed Ship To Address on a current order row between two uploads, or made by editing a manual
# order (then only `manual_order` is set). Immutable.
class AddressChange < ApplicationRecord
  belongs_to :upload_batch, optional: true
  belongs_to :previous_upload_batch, class_name: "UploadBatch", optional: true
  belongs_to :order_row, optional: true
  belongs_to :previous_order_row, class_name: "OrderRow", optional: true
  belongs_to :manual_order, optional: true

  def readonly?
    persisted?
  end
end
