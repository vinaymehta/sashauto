# One order-ageing email (or the silent baseline recorded on the first run).
class AgeingDigest < ApplicationRecord
  MODES = %w[scheduled manual preview baseline].freeze

  belongs_to :upload_batch, optional: true
  belongs_to :requested_by, class_name: "User", optional: true
  has_many :ageing_notifications

  def sent?
    status == "sent"
  end
end
