require "digest"

# Signs in to the Deere supplier portal (SecurePortal), downloads the requirement report of each business (DTP: Wood
# Dale, GMBH: Faridabad; see AppConfig.portal_supplier) and uploads each to its business like a manual upload (Uploads::Intake,
# as the first active admin), so the usual checks and emails run. A file the same as the business's last upload is
# skipped. Started by sidekiq-cron at 08:00 and 20:00 IST (config/schedule.yml), or right away from Admin Settings →
# Deere portal ("Run sync now"). One run at a time (PortalSync lock); its status and results are kept for that page.
class SecurePortalSyncJob < ApplicationJob
  # A failed run is not retried: each retry would sign in to Deere again (and could lock the account or send another
  # SMS). The next scheduled run tries again.
  sidekiq_options retry: false

  # `trigger`: "schedule" (sidekiq-cron) or "manual" (Run sync now, by `user_id`).
  def perform(trigger = "schedule", user_id = nil)
    token = SecureRandom.hex(8)
    unless PortalSync.lock(token)
      Rails.logger.info("[secure_portal] a sync is already running; this #{trigger} run is skipped")
      return
    end

    run = { trigger: trigger, by: user_id && User.find_by(id: user_id)&.name, started_at: Time.current }
    PortalSync.write(run.merge(state: "running"))
    results = []
    error = nil
    finished = false
    begin
      suppliers = Business::KEYS.to_h { |business| [ business, AppConfig.portal_supplier(business) ] }
      portal = SecurePortal.new
      files = portal.call(suppliers)
      results = suppliers.keys.map do |business|
        files[business] ? upload(files[business], business) : { business: business, status: "failed", message: portal.errors[business] || "Download failed." }
      end
      finished = true
    rescue StandardError => e
      error = "#{e.class}: #{e.message.lines.first&.strip}"
      raise
    ensure
      # Neither finished nor failed: stopped from outside (Sidekiq shutting down; Sidekiq then queues the job again).
      error ||= "Stopped before it finished." unless finished
      PortalSync.write(run.merge(state: error ? "failed" : "done", finished_at: Time.current, results: results, error: error))
      PortalSync.unlock(token)
    end
  end

  private

  # Uploads one business's file; returns its result for the status.
  def upload(path, business)
    result = { business: business, file: File.basename(path) }
    sha256 = Digest::SHA256.file(path).hexdigest
    if UploadBatch.where(business: business).where.not(status: "failed").order(:id).last&.file_sha256 == sha256
      Rails.logger.info("[secure_portal] #{File.basename(path)} is the same as the last upload; not uploaded")
      return result.merge(status: "same")
    end

    admin = User.active.admins.order(:id).first or raise "No active admin user to upload as."
    batch = File.open(path, "rb") do |io|
      file = ActionDispatch::Http::UploadedFile.new(tempfile: io, filename: File.basename(path), type: Uploads::Intake::XLSX_CONTENT_TYPE)
      Uploads::Intake.call(file: file, user: admin, business: business)
    end
    AuditLog.record("upload.received", user: admin, subject: batch, filename: batch.original_filename, sha256: batch.file_sha256,
                                       source: "deere_portal", business: business)
    Rails.logger.info("[secure_portal] uploaded #{batch.original_filename} as upload ##{batch.id}")
    result.merge(status: "uploaded", upload_id: batch.id)
  rescue StandardError => e
    result.merge(status: "failed", message: "Upload failed: #{e.message.lines.first&.strip}")
  end
end
