# A part of an upload whose balance still to order (Firm Qty - PO issued, `qty`) was below its MOQ (Comparison::
# MoqChecker; firm_qty / po_issued_qty / received_qty set, on the part's first row), or a manual order below MOQ when
# it was created or edited (then `upload_batch` is not set). Alerts of uploads before the per-part check are per order
# row, without those figures. Immutable.
class MoqAlert < ApplicationRecord
  belongs_to :upload_batch, optional: true
  belongs_to :order_row, optional: true
  belongs_to :manual_order, optional: true
  belongs_to :product

  def readonly?
    persisted?
  end
end
