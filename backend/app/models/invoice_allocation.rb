# Qty of one invoice line given to one order row (Invoices::Allocator): dispatched (SASH India invoice) or outbound
# (SASH Inc invoice). Keyed like the status marks (VendorOrderPlacement.order_key: PO + Part + Type + PO Line + Ship
# Date, or the manual order), so it stays on the order in later uploads. `order_qty`: the row's Qty when it was given.
# Append-only: removing the invoice is what takes it back.
class InvoiceAllocation < ApplicationRecord
  belongs_to :invoice
  belongs_to :order_row, optional: true
  belongs_to :manual_order, optional: true

  # Allocations of invoices that are not removed.
  scope :active, -> { joins(:invoice).where(invoices: { removed_at: nil }) }

  def readonly?
    persisted?
  end
end
