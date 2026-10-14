# The part of an order placed with one vendor, numbered VPO-000001, VPO-000002, ... Its allocation is locked
# after placement (database trigger); only the email delivery columns change. Its purchase order is a PDF saved at
# placement (`pdf`); it is emailed to the vendor only when an admin asks (email_status starts as "not_sent").
class VendorOrder < ApplicationRecord
  EMAIL_STATUSES = %w[not_sent pending sent failed no_email].freeze

  has_one_attached :pdf

  belongs_to :vendor_order_placement
  belongs_to :vendor

  validates :email_status, inclusion: { in: EMAIL_STATUSES }

  def self.next_number
    "VPO-#{connection.select_value("SELECT nextval('vendor_order_number_seq')").to_s.rjust(6, '0')}"
  end

  def email_sent?
    email_status == "sent"
  end

  # The saved purchase order PDF; made (and saved) now for an order placed before PDFs existed.
  def pdf_document
    attach_pdf unless pdf.attached?
    pdf.download
  end

  def attach_pdf
    pdf.attach(io: StringIO.new(VendorOrders::PdfBuilder.for_order(self)), filename: "#{number}.pdf", content_type: "application/pdf")
  end
end
