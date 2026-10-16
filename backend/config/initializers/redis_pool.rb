# Redis connections for app code: the SMS OTP handoff between the admin's browser and the Deere portal job
# (OtpHandoff), the job's status and lock (SecurePortalSyncJob) and the Chrome slot count (WebdriverSetup).
# Same Redis as Sidekiq.
REDIS_POOL = ConnectionPool.new(size: Integer(ENV.fetch("RAILS_MAX_THREADS", 5)), timeout: 5) { Redis.new(url: AppConfig.redis_url) }
