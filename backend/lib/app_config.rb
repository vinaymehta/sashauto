# Central place for environment-driven settings. Blank values (e.g. `RESEND_FROM=` in .env) count as unset.
module AppConfig
  module_function

  def env(name, default = nil)
    ENV[name].presence || default
  end

  # A setting that must come from the environment (.env) in production. The local default is used only
  # in development/test, so a missing value can never silently point a server at localhost.
  def required(name, local_default)
    value = ENV[name].presence
    return value if value
    raise KeyError, "#{name} must be set in the environment (see backend/.env.example)" if Rails.env.production?
    local_default
  end

  def redis_url
    required("REDIS_URL", "redis://localhost:6379/0")
  end

  # Sender of every email: an address on the domain verified in Resend.
  def mail_from
    required("RESEND_FROM", "order-tracker@localhost")
  end

  # Comma-separated. When blank, notifications go to every active Admin user.
  # SASH (the buyer) on vendor purchase order PDFs: header, delivery and invoice address.
  def company
    {
      name: env("COMPANY_NAME", "SASH Autotech Pvt. Ltd."),
      address: env("COMPANY_ADDRESS", ""),
      gst: env("COMPANY_GST", ""),
      phone: env("COMPANY_PHONE", ""),
      email: env("COMPANY_EMAIL", ""),
      terms_url: env("COMPANY_TERMS_URL", "")
    }
  end

  # Where orders are normally shipped; rows with any other Ship To are flagged and emailed (Orders::ShipTo).
  def default_ship_to
    env("DEFAULT_SHIP_TO", "XPAC, 824 E 8TH ST, MILAN, IL 612643110")
  end

  def admin_notification_emails
    env("ADMIN_NOTIFICATION_EMAILS", "").split(",").map(&:strip).reject(&:empty?)
  end

  # Public URL of the frontend (what users open in the browser), used for links in emails.
  def app_url
    required("APP_URL", "http://localhost:3000")
  end

  # True when the app is served over HTTPS (APP_URL starts with https://). Production then redirects to
  # HTTPS and sends the session cookie only over HTTPS; on plain http:// both are off, or login would fail.
  def https?
    URI(app_url).scheme == "https"
  end

  # Time zone whose calendar day the ageing email (sent with each upload) uses.
  def ageing_time_zone
    env("AGEING_TIME_ZONE", "Asia/Kolkata")
  end

  # Slack Incoming Webhook for alerts (the portal's OTP request and failures). Blank: alerts are only logged.
  def slack_webhook_url
    env("SLACK_WEBHOOK_URL")
  end

  def max_upload_bytes
    Integer(env("MAX_UPLOAD_BYTES", 20.megabytes))
  end

  # Emails are sent only through the Resend API. Production requires RESEND_API_KEY; in development
  # without a key, emails are written to tmp/mails instead.
  def resend_api_key
    required("RESEND_API_KEY", nil)
  end

  # :resend when a Resend API key is configured, otherwise nil (development only: file delivery).
  def mail_delivery_method
    resend_api_key ? :resend : nil
  end
end
