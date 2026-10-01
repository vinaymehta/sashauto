# Outbox record for one admin email about an upload. Created inside the upload's commit transaction and
# delivered afterwards by Notifications::DeliverJob, which can be retried safely. Each kind is its own
# email with its own template; an upload has at most one notification per kind.
class Notification < ApplicationRecord
  STATUSES = %w[pending sent failed].freeze
  KINDS = %w[quantity_changes address_changes moq_alerts].freeze

  belongs_to :upload_batch

  validates :status, inclusion: { in: STATUSES }
  validates :kind, inclusion: { in: KINDS }

  scope :undelivered, -> { where(status: %w[pending failed]) }

  def sent?
    status == "sent"
  end

  # Number of rows the email reports.
  def count
    case kind
    when "address_changes" then address_change_count
    when "moq_alerts" then moq_alert_count
    else change_count
    end
  end

  def message
    case kind
    when "address_changes" then AddressChangeMailer.with(notification: self).changes_detected
    when "moq_alerts" then MoqAlertMailer.with(notification: self).alerts_detected
    else QuantityChangeMailer.with(notification: self).changes_detected
    end
  end
end
