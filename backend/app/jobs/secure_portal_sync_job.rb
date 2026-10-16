# Signs in to the Deere supplier portal (SecurePortal) and saves the session. Started by sidekiq-cron at 08:00 and
# 20:00 IST (config/schedule.yml).
class SecurePortalSyncJob < ApplicationJob
  # A failed run is not retried: each retry would sign in to Deere again (and could lock the account or send another
  # SMS). The next scheduled run tries again.
  sidekiq_options retry: false

  def perform
    SecurePortal.new.call
  end
end
