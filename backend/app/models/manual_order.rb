# An order created by an Admin by hand, with the same 47 columns as a Supplier Requirements Excel row.
# Kept apart from imported order rows: uploads never update or delete it. Editable; deleting is soft
# (`deleted_at`) because its detection records are append-only and reference it.
class ManualOrder < ApplicationRecord
  # Every column of the Supplier Requirements export ("03.10.2026 - DTP.xlsx"), in file order.
  HEADERS = [
    "Type", "Due Date", "Ship Date", "Unit", "Plant Code", "PO Number", "PO Line Number", "Part Number",
    "Commodity Type", "Qty", "Previous Qty", "Last ASN Qty", "Last ASN Date", "Last Receipt Qty",
    "Last Receipt Date", "Last Packing List Number", "Ship to Location", "Dock Number", "Supplier Part Number",
    "Trigger Number", "Line Feed Location", "Department Number", "Cumulative Receipt Qty", "Unit Price",
    "Last Released Date", "Last Updated Date", "EC Level", "Customer Order Num", "Userid", "Timestamp",
    "Ship to Name", "Ship To Address", "Ship to City", "Ship to Region", "Ship to PostalCode", "Order Type",
    "Ship Type", "Ship Instructions", "Truck ID", "Distribution Point", "Routing Information",
    "Returnable Container", "List ID", "Crossdock Location", "Dealer Reference #", "Current Release Date",
    "Current Release Number"
  ].freeze

  belongs_to :created_by, class_name: "User"
  belongs_to :updated_by, class_name: "User"
  has_many :quantity_changes
  has_many :address_changes
  has_many :moq_alerts

  scope :active, -> { where(deleted_at: nil) }

  # Detection records of `model` (QuantityChange, AddressChange, MoqAlert) created by manual creates and
  # edits of orders that are not deleted, optionally only those after `since`.
  def self.detections(model, since: nil)
    scope = model.where(upload_batch_id: nil, manual_order_id: active.select(:id))
    since ? scope.where(created_at: since..) : scope
  end
end
