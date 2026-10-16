Sidekiq.configure_server do |config|
  config.redis = { url: AppConfig.redis_url }
end

Sidekiq.configure_client do |config|
  config.redis = { url: AppConfig.redis_url }
end

# Sidekiq dashboard at /sidekiq (queues, failed jobs, and the Cron tab of sidekiq-cron), only when
# SIDEKIQ_WEB_PASSWORD is set in .env, behind HTTP Basic auth (SIDEKIQ_WEB_USERNAME, default "admin").
if AppConfig.env("SIDEKIQ_WEB_PASSWORD")
  require "sidekiq/web"
  require "sidekiq/cron/web"

  Sidekiq::Web.use Rack::Auth::Basic, "Sidekiq" do |username, password|
    ActiveSupport::SecurityUtils.secure_compare(username, AppConfig.env("SIDEKIQ_WEB_USERNAME", "admin")) &
      ActiveSupport::SecurityUtils.secure_compare(password, AppConfig.env("SIDEKIQ_WEB_PASSWORD"))
  end
end
