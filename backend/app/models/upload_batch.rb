class UploadBatch < ApplicationRecord
  STATUSES = %w[pending processing completed failed].freeze

  belongs_to :uploaded_by, class_name: "User"
  belongs_to :previous_upload_batch, class_name: "UploadBatch", optional: true
  has_one_attached :file
  has_many :order_snapshot_rows
  has_many :order_rows
  has_many :quantity_changes
  has_many :address_changes
  has_many :moq_alerts
  has_many :notifications
  has_many :ageing_digests

  validates :status, inclusion: { in: STATUSES }
  validates :original_filename, :file_sha256, :byte_size, presence: true

  scope :completed, -> { where(status: "completed") }
  scope :latest_completed_first, -> { completed.order(version_number: :desc) }

  def self.latest_completed
    latest_completed_first.first
  end

  def completed?
    status == "completed"
  end

  def finished?
    %w[completed failed].include?(status)
  end

  def version_label
    version_number && "V#{version_number}"
  end
end
