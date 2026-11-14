# A file uploaded on the Purchase orders page: a vendor PO list (kind "orders", VendorOrders::FileImport) or a Purchase
# Received file ("received", VendorOrders::ReceivedImport): who uploaded it, how many rows it had, how many it recorded
# and the rows it skipped with the reason ({ row:, part_number:, po_number:, vendor:, vendor_po:, reason: }; also open
# as purchase issues).
class VendorPoImport < ApplicationRecord
  KINDS = %w[orders received].freeze

  belongs_to :uploaded_by, class_name: "User"
  has_many :vendor_order_placements
  has_many :purchase_issues
  has_one_attached :file
end
