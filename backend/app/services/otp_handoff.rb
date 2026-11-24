# Lets a Sidekiq worker that hits an OTP screen pause and wait for a person to type the code (received by SMS) into the
# app: the Deere sync popup (POST /api/portal_sync/otp).
#
# Worker side:
#   code = OtpHandoff.new('secure_portal', label: 'John Deere').wait_for_code
#
# Web side (Api::PortalSyncController):
#   OtpHandoff.request(key)     # the request waiting for a code, or nil
#   OtpHandoff.submit(key, code)
#
# Everything lives in Redis with a TTL, so an abandoned request disappears on its own and nothing needs a migration.
class OtpHandoff
  # Nobody entered the code before the deadline (the worker gives up).
  class TimedOut < StandardError; end

  REQUEST_PREFIX = "otp_requests:".freeze
  CODE_PREFIX    = "otp_codes:".freeze
  # OTP codes typically expire in 5-10 min, and a worker shouldn't hold a chromedriver slot much longer than that.
  WAIT_TIMEOUT  = 480
  POLL_INTERVAL = 5

  attr_reader :key

  def initialize(key, label:)
    @key = key.to_s
    @label = label
  end

  # Opens a request (the popup's OTP box shows it) and blocks until a code is submitted or the deadline passes. Returns
  # the code, or nil on timeout. `alert`: once the request is open, tell the people who look after the sync right away
  # (PortalAlerts.otp_needed: email, Slack and bell), once per request: the polling below never alerts again.
  def wait_for_code(message: nil, deadline: Time.now + WAIT_TIMEOUT, alert: false)
    open_request(message, deadline)
    PortalAlerts.otp_needed(expires_at: deadline) if alert
    while Time.now < deadline
      code = take_code
      return code if code

      sleep POLL_INTERVAL
    end
    finish
    nil
  end

  # Call once the code was accepted (or the worker gives up) so the request drops out of the popup.
  def finish
    REDIS_POOL.with { |r| r.del(request_key, code_key) }
  end

  # The request waiting for a code: { "label", "message", "status" ("waiting", or "submitted" once a code was typed),
  # "requested_at", "expires_at" }, or nil.
  def self.request(key)
    found = REDIS_POOL.with { |r| r.hgetall("#{REQUEST_PREFIX}#{key}") }
    found.presence && found["status"] ? found : nil
  end

  def self.submit(key, code)
    code = code.to_s.gsub(/\s+/, "")
    return false if code.empty?

    REDIS_POOL.with do |r|
      return false unless r.exists?("#{REQUEST_PREFIX}#{key}")

      r.set("#{CODE_PREFIX}#{key}", code, ex: WAIT_TIMEOUT)
      r.hset("#{REQUEST_PREFIX}#{key}", "status", "submitted")
    end
    true
  end

  private

  def request_key
    "#{REQUEST_PREFIX}#{@key}"
  end

  def code_key
    "#{CODE_PREFIX}#{@key}"
  end

  def open_request(message, deadline)
    message ||= "#{@label} is asking for the SMS OTP. Enter it to let the sync continue."
    REDIS_POOL.with do |r|
      r.del(code_key) # never reuse a code typed for an earlier attempt
      r.mapped_hmset(request_key, "label" => @label, "message" => message, "status" => "waiting",
                                  "requested_at" => Time.now.utc.iso8601, "expires_at" => deadline.utc.iso8601)
      r.expire(request_key, WAIT_TIMEOUT + 60)
    end
  end

  def take_code
    REDIS_POOL.with do |r|
      code, _ = r.multi do |m|
        m.get(code_key)
        m.del(code_key)
      end
      code
    end
  end
end
