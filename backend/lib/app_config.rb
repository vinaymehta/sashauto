# Central place for environment-driven settings. Blank values (e.g. `MAIL_FROM=` in .env) count as unset.
module AppConfig
  module_function

  def env(name, default = nil)
    ENV[name].presence || default
  end

  def redis_url
    env("REDIS_URL", "redis://localhost:6379/0")
  end

  # Resend sends from an address on the verified domain (RESEND_FROM); SMTP uses MAIL_FROM.
  def mail_from
    fallback = env("MAIL_FROM", env("SMTP_USERNAME", "order-tracker@localhost"))
    mail_delivery_method == :resend ? env("RESEND_FROM", fallback) : fallback
  end

  # Comma-separated. When blank, notifications go to every active Admin user.
  def admin_notification_emails
    env("ADMIN_NOTIFICATION_EMAILS", "").split(",").map(&:strip).reject(&:empty?)
  end

  # Public URL of the frontend, used for links in emails.
  def app_url
    env("APP_URL", "http://localhost:3000")
  end

  # Time zone whose calendar day the ageing digest uses (and its 09:00 schedule).
  def ageing_time_zone
    env("AGEING_TIME_ZONE", "Asia/Kolkata")
  end

  def max_upload_bytes
    Integer(env("MAX_UPLOAD_BYTES", 20.megabytes))
  end

  # :resend when a Resend API key is configured, :smtp when an SMTP server is, otherwise nil.
  def mail_delivery_method
    return :resend if env("RESEND_API_KEY")
    return :smtp if env("SMTP_ADDRESS")
    nil
  end

  def smtp_settings
    {
      address: env("SMTP_ADDRESS"),
      port: Integer(env("SMTP_PORT", 587)),
      user_name: env("SMTP_USERNAME"),
      password: env("SMTP_PASSWORD")&.delete(" "), # Gmail App Passwords are often pasted with spaces
      authentication: env("SMTP_AUTHENTICATION", "plain").to_sym,
      enable_starttls_auto: true
    }
  end
end
