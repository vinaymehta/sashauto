# One placement of an order row (or manual order) to vendors: the order details at placement time and the
# Vendor Orders (one per vendor). Locked once created (database trigger).
class VendorOrderPlacement < ApplicationRecord
  belongs_to :order_row, optional: true
  belongs_to :upload_batch, optional: true
  belongs_to :manual_order, optional: true
  belongs_to :product, optional: true
  belongs_to :placed_by, class_name: "User"
  has_many :vendor_orders, -> { order(:number) }

  def readonly?
    persisted?
  end

  # Identifies an order row across uploads: PO Number + Part Number + Type (group_key), PO Line Number
  # and Ship Date. A row with this key can be placed once. A manual order is its own order (it may share
  # the key with imported rows), so it is identified by its id.
  def self.order_key(row)
    parts = row.is_a?(ManualOrder) ? [ "manual", row.id ] : [ row.group_key, row.po_line_number, row.ship_date.iso8601 ]
    Digest::SHA256.hexdigest(parts.join(OrderRows::Normalizer::KEY_SEPARATOR))
  end
end
