# Central place for environment-driven settings. Blank values (e.g. `MAIL_FROM=` in .env) count as unset.
module AppConfig
  module_function

  def env(name, default = nil)
    ENV[name].presence || default
  end

  def redis_url
    env("REDIS_URL", "redis://localhost:6379/0")
  end

  def mail_from
    env("MAIL_FROM", env("SMTP_USERNAME", "order-tracker@localhost"))
  end

  # Comma-separated. When blank, notifications go to every active Admin user.
  def admin_notification_emails
    env("ADMIN_NOTIFICATION_EMAILS", "").split(",").map(&:strip).reject(&:empty?)
  end

  # Public URL of the frontend, used for links in emails.
  def app_url
    env("APP_URL", "http://localhost:3000")
  end

  def max_upload_bytes
    Integer(env("MAX_UPLOAD_BYTES", 20.megabytes))
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
