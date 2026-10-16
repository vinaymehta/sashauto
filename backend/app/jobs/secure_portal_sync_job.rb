require "digest"

# Signs in to the Deere supplier portal (SecurePortal), downloads the requirement report and uploads it like a
# manual upload (Uploads::Intake, as the first active admin), so the usual checks and emails run. Skipped when the
# file is the same as the last upload. Started by sidekiq-cron at 08:00 and 20:00 IST (config/schedule.yml).
class SecurePortalSyncJob < ApplicationJob
  # A failed run is not retried: each retry would sign in to Deere again (and could lock the account or send another
  # SMS). The next scheduled run tries again.
  sidekiq_options retry: false

  def perform
    file = SecurePortal.new.call
    upload(file) if file
  end

  private

  def upload(path)
    sha256 = Digest::SHA256.file(path).hexdigest
    if UploadBatch.where.not(status: "failed").order(:id).last&.file_sha256 == sha256
      Rails.logger.info("[secure_portal] #{File.basename(path)} is the same as the last upload; not uploaded")
      return
    end

    admin = User.active.admins.order(:id).first or raise "No active admin user to upload as."
    batch = File.open(path, "rb") do |io|
      file = ActionDispatch::Http::UploadedFile.new(tempfile: io, filename: File.basename(path), type: Uploads::Intake::XLSX_CONTENT_TYPE)
      Uploads::Intake.call(file: file, user: admin)
    end
    AuditLog.record("upload.received", user: admin, subject: batch, filename: batch.original_filename, sha256: batch.file_sha256,
                                       source: "deere_portal")
    Rails.logger.info("[secure_portal] uploaded #{batch.original_filename} as upload ##{batch.id}")
  end
end
