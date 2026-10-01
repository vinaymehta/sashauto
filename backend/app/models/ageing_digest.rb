# One order-ageing email, sent with each upload (or the silent baseline recorded on the first run).
# Modes scheduled/manual/preview are kept only for digests created before ageing moved to uploads.
class AgeingDigest < ApplicationRecord
  MODES = %w[upload baseline scheduled manual preview].freeze

  belongs_to :upload_batch, optional: true
  belongs_to :requested_by, class_name: "User", optional: true
  has_many :ageing_notifications

  def sent?
    status == "sent"
  end
end
