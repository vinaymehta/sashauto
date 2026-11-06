# An uploaded SASH invoice (Orders → Actions, Invoices::Reader): kind "india" (export invoice of SASH Autotech Pvt. Ltd.,
# India, to Lotus Automotive: its Qty is dispatched from India, in transit) or "inc" (SASH Autotech, Inc., US, to John
# Deere: dispatched Qty delivered to Deere, outbound). `lines`: what the file lists (PO, Part, Qty); `allocations`: the
# Qty each order row took (Invoices::Allocator, oldest Ship Date first); `unmatched_lines`: Qty no order row took, with
# the reason. One active invoice per kind and number; removing one (admin) keeps it with removed_at/by.
class Invoice < ApplicationRecord
  KINDS = %w[india inc].freeze
  LABELS = { "india" => "SASH India invoice", "inc" => "SASH Inc invoice" }.freeze

  belongs_to :uploaded_by, class_name: "User"
  belongs_to :removed_by, class_name: "User", optional: true
  has_many :allocations, -> { order(:id) }, class_name: "InvoiceAllocation"
  has_one_attached :file

  validates :kind, inclusion: { in: KINDS }
  validates :invoice_number, presence: true, length: { maximum: 64 }
  validates :invoice_date, :original_filename, presence: true

  scope :active, -> { where(removed_at: nil) }

  def label
    LABELS.fetch(kind)
  end
end
