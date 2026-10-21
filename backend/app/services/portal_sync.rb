require "json"

# Lock and status of the Deere portal sync (SecurePortalSyncJob), in Redis. The lock keeps two runs (the schedule and
# "Run sync now" in Admin Settings) from signing in to Deere at the same time; the status (the current or last run and
# each business's result) is what Admin Settings → Deere portal shows.
module PortalSync
  LOCK_KEY = "portal_sync:lock".freeze
  STATUS_KEY = "portal_sync:status".freeze
  # A run can wait up to 8 minutes for an SMS OTP; a worker that dies mid-run frees the lock after this at the latest.
  LOCK_TTL = 1.hour.to_i

  module_function

  # The current or last run: state ("never", "queued", "running", "done", "failed"), trigger ("manual", "schedule"),
  # who asked (manual), times, results ([{ business, status, upload_id, file, message }]) and error.
  def status
    raw = REDIS_POOL.with { |r| r.get(STATUS_KEY) }
    (raw && JSON.parse(raw)) || { "state" => "never" }
  end

  def running?
    REDIS_POOL.with { |r| r.exists?(LOCK_KEY) }
  end

  # Takes the lock for a run; false when another run holds it.
  def lock(token)
    REDIS_POOL.with { |r| r.set(LOCK_KEY, token, nx: true, ex: LOCK_TTL) }
  end

  def unlock(token)
    REDIS_POOL.with { |r| r.del(LOCK_KEY) if r.get(LOCK_KEY) == token }
  end

  def write(attrs)
    REDIS_POOL.with { |r| r.set(STATUS_KEY, attrs.to_json) }
  end
end
