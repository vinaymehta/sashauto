# Goods a vendor delivered against a vendor PO: the vendor's invoice number and date and the Qty (pieces), from an
# uploaded Purchase Received file (VendorOrders::ReceivedImport) or entered by hand on the Purchase orders page.
class VendorOrderReceipt < ApplicationRecord
  belongs_to :vendor_order
  belongs_to :vendor_po_import, optional: true
  belongs_to :created_by, class_name: "User"
end
