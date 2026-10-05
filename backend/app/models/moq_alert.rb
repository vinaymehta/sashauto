# A current order row (or manual order) whose Qty was below its Part Number's MOQ in an upload, or a manual
# order below MOQ when it was created or edited (then `upload_batch` is not set). Immutable.
class MoqAlert < ApplicationRecord
  belongs_to :upload_batch, optional: true
  belongs_to :order_row, optional: true
  belongs_to :manual_order, optional: true
  belongs_to :product

  def readonly?
    persisted?
  end
end
