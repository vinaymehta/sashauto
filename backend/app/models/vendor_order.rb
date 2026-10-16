# The part of an order placed with one vendor, numbered "<JD PO No.>/<vendor acronym>/<order Ship Date DD-MM-YY>"
# (#po_number; VPO-000001, ... before Oct 2026). Its allocation is locked
# after the PO is generated (database trigger). Its purchase order is a PDF saved then (`pdf`), with the Intimation
# Letter (`intimation_letter`, VendorOrders::IntimationLetter); they are not emailed from the app: an admin ticks
# "Order placed" (order_placed_at) once they were sent to the vendor.
class VendorOrder < ApplicationRecord
  EMAIL_STATUSES = %w[not_sent pending sent failed no_email].freeze

  has_one_attached :pdf
  has_one_attached :intimation_letter

  belongs_to :vendor_order_placement
  belongs_to :vendor
  belongs_to :order_placed_by, class_name: "User", optional: true

  validates :email_status, inclusion: { in: EMAIL_STATUSES }

  # Serializes numbering (call inside the transaction that creates the vendor orders).
  NUMBER_LOCK_KEY = 7_311_003

  # "5500936312/ZSCTCL/30-04-26": the JD PO number, the vendor's code (else the acronym of its name) and the order's
  # Ship Date; "-2", "-3", ...
  # added when that number is taken (the same vendor, PO and Ship Date for another line or part).
  def self.po_number(jd_po_number, vendor, ship_date)
    base = [ jd_po_number, vendor.code.presence || acronym(vendor.name), ship_date.strftime("%d-%m-%y") ].join("/")
    taken = where(number: base).or(where("number LIKE ?", "#{sanitize_sql_like(base)}-%")).pluck(:number).to_set
    return base unless taken.include?(base)

    "#{base}-#{(2..).find { |n| !taken.include?("#{base}-#{n}") }}"
  end

  # First letter of every word of the name: "Zhejiang Shenlong Chain Transmission Co., Ltd." => "ZSCTCL",
  # "A.H Industrial Corporation" => "AHIC".
  def self.acronym(name)
    name.to_s.scan(/[[:alnum:]]+/).map { |word| word[0] }.join.upcase
  end

  # File name of the PO PDF (a PO number has slashes).
  def file_name
    "#{number.tr('/', '-')}.pdf"
  end

  # The saved purchase order PDF; made (and saved) now for an order placed before PDFs existed.
  def pdf_document
    attach_pdf unless pdf.attached?
    pdf.download
  end

  def attach_pdf
    pdf.attach(io: StringIO.new(VendorOrders::PdfBuilder.for_order(self)), filename: file_name, content_type: "application/pdf")
  end

  def letter_file_name
    "Intimation-#{file_name}"
  end

  # The saved Intimation Letter; made (and saved) now for an order placed before letters existed.
  def letter_document
    attach_letter unless intimation_letter.attached?
    intimation_letter.download
  end

  def attach_letter
    intimation_letter.attach(io: StringIO.new(VendorOrders::IntimationLetter.for_order(self)), filename: letter_file_name,
                             content_type: "application/pdf")
  end
end
