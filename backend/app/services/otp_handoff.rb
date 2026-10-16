# Lets a Sidekiq worker that hits an OTP screen pause and wait for a human to
# type the code (received by SMS) into the app at /otp_requests.
#
# Worker side:
#   code = OtpHandoff.new('secure_portal', label: 'John Deere').wait_for_code
#
# Web side (OtpRequestsController):
#   OtpHandoff.pending          # requests currently waiting for a code
#   OtpHandoff.submit(key, code)
#
# Everything lives in Redis with a TTL, so an abandoned request disappears on
# its own and nothing needs a migration.
class OtpHandoff
  REQUEST_PREFIX = 'otp_requests:'.freeze
  CODE_PREFIX    = 'otp_codes:'.freeze
  # OTP codes typically expire in 5-10 min, and a worker shouldn't hold a
  # chromedriver slot much longer than that.
  WAIT_TIMEOUT  = 480
  POLL_INTERVAL = 5

  attr_reader :key

  def initialize(key, label:)
    @key = key.to_s
    @label = label
  end

  # Opens (or re-opens, after a rejected code) a request, alerts the team, and
  # blocks until a code is submitted or the deadline passes. Returns the code
  # or nil on timeout.
  def wait_for_code(message: nil, deadline: Time.now + WAIT_TIMEOUT)
    open_request(message)
    while Time.now < deadline
      code = take_code
      return code if code

      sleep POLL_INTERVAL
    end
    finish
    SlackNotifier.new.notify_otp_required(@label, "OTP request for #{@label} timed out -- nobody entered the code. It will be asked again on the next run.", url: nil) rescue nil
    nil
  end

  # Call once the code was accepted (or the worker gives up) so the request
  # drops off the /otp_requests page.
  def finish
    REDIS_POOL.with { |r| r.del(request_key, code_key) }
  end

  def self.pending
    REDIS_POOL.with do |r|
      r.scan_each(match: "#{REQUEST_PREFIX}*").map do |redis_key|
        r.hgetall(redis_key).merge('key' => redis_key.delete_prefix(REQUEST_PREFIX))
      end
    end.reject { |req| req['status'].nil? }.sort_by { |req| req['requested_at'].to_s }
  end

  def self.submit(key, code)
    code = code.to_s.gsub(/\s+/, '')
    return false if code.empty?

    REDIS_POOL.with do |r|
      return false unless r.exists("#{REQUEST_PREFIX}#{key}")

      r.set("#{CODE_PREFIX}#{key}", code, ex: WAIT_TIMEOUT)
      r.hset("#{REQUEST_PREFIX}#{key}", 'status', 'submitted')
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

  def open_request(message)
    message ||= "#{@label} is asking for the SMS OTP. Enter it to let the scraper continue."
    REDIS_POOL.with do |r|
      r.del(code_key) # never reuse a code typed for an earlier attempt
      r.mapped_hmset(request_key, 'label' => @label, 'message' => message, 'status' => 'waiting',
                                  'requested_at' => Time.now.utc.iso8601)
      r.expire(request_key, WAIT_TIMEOUT + 60)
    end

    path = "/otp_requests##{@key}"
    SlackNotifier.new.notify_otp_required(@label, message, url: "#{AppConfig.backend_public_url}#{path}") rescue nil
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