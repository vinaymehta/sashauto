# The part of an order placed with one vendor, numbered VPO-000001, VPO-000002, ... Its allocation is locked
# after placement (database trigger); only the email delivery columns change.
class VendorOrder < ApplicationRecord
  EMAIL_STATUSES = %w[pending sent failed no_email].freeze

  belongs_to :vendor_order_placement
  belongs_to :vendor

  validates :email_status, inclusion: { in: EMAIL_STATUSES }

  def self.next_number
    "VPO-#{connection.select_value("SELECT nextval('vendor_order_number_seq')").to_s.rjust(6, '0')}"
  end

  def email_sent?
    email_status == "sent"
  end
end
