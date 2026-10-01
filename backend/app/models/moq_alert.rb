# A current order row whose Qty was below its Part Number's MOQ in an upload. Immutable.
class MoqAlert < ApplicationRecord
  belongs_to :upload_batch
  belongs_to :order_row
  belongs_to :product

  def readonly?
    persisted?
  end
end
