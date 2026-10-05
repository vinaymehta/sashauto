# One placement of an order row to vendors: the order details at placement time and the Vendor Orders
# (one per vendor). Locked once created (database trigger).
class VendorOrderPlacement < ApplicationRecord
  belongs_to :order_row
  belongs_to :upload_batch
  belongs_to :product, optional: true
  belongs_to :placed_by, class_name: "User"
  has_many :vendor_orders, -> { order(:number) }

  def readonly?
    persisted?
  end

  # Identifies an order row across uploads: PO Number + Part Number + Type (group_key), PO Line Number
  # and Ship Date. A row with this key can be placed once.
  def self.order_key(row)
    Digest::SHA256.hexdigest([ row.group_key, row.po_line_number, row.ship_date.iso8601 ].join(OrderRows::Normalizer::KEY_SEPARATOR))
  end
end
