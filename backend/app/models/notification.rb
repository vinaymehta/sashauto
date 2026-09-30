# Outbox record for an admin email. Created inside the upload's commit transaction and
# delivered afterwards by Notifications::DeliverJob, which can be retried safely.
class Notification < ApplicationRecord
  STATUSES = %w[pending sent failed].freeze

  belongs_to :upload_batch

  validates :status, inclusion: { in: STATUSES }

  scope :undelivered, -> { where(status: %w[pending failed]) }

  def sent?
    status == "sent"
  end
end
