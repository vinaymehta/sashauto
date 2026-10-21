require "digest"

# Signs in to the Deere supplier portal (SecurePortal), downloads the requirement report of each business (DTP: Wood
# Dale, GMBH: Faridabad; see AppConfig.portal_supplier) and uploads each to its business like a manual upload (Uploads::Intake,
# as the first active admin), so the usual checks and emails run. A file the same as the business's last upload is
# skipped. Started by sidekiq-cron at 08:00 and 20:00 IST (config/schedule.yml).
class SecurePortalSyncJob < ApplicationJob
  # A failed run is not retried: each retry would sign in to Deere again (and could lock the account or send another
  # SMS). The next scheduled run tries again.
  sidekiq_options retry: false

  def perform
    suppliers = Business::KEYS.to_h { |business| [ business, AppConfig.portal_supplier(business) ] }
    SecurePortal.new.call(suppliers).each { |business, file| upload(file, business) }
  end

  private

  def upload(path, business)
    sha256 = Digest::SHA256.file(path).hexdigest
    if UploadBatch.where(business: business).where.not(status: "failed").order(:id).last&.file_sha256 == sha256
      Rails.logger.info("[secure_portal] #{File.basename(path)} is the same as the last upload; not uploaded")
      return
    end

    admin = User.active.admins.order(:id).first or raise "No active admin user to upload as."
    batch = File.open(path, "rb") do |io|
      file = ActionDispatch::Http::UploadedFile.new(tempfile: io, filename: File.basename(path), type: Uploads::Intake::XLSX_CONTENT_TYPE)
      Uploads::Intake.call(file: file, user: admin, business: business)
    end
    AuditLog.record("upload.received", user: admin, subject: batch, filename: batch.original_filename, sha256: batch.file_sha256,
                                       source: "deere_portal", business: business)
    Rails.logger.info("[secure_portal] uploaded #{batch.original_filename} as upload ##{batch.id}")
  end
end
