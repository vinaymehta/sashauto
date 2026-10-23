# Error tracking with Bugsnag: unhandled errors of the API and of Sidekiq jobs (the portal sync, uploads, emails) are
# reported to Bugsnag when BUGSNAG_API_KEY is set (.env); without it nothing is sent. Only production reports, and
# values Rails filters from its logs (passwords, tokens, OTP codes…) are redacted.
Bugsnag.configure do |config|
  config.api_key = AppConfig.env("BUGSNAG_API_KEY")
  config.release_stage = AppConfig.env("BUGSNAG_RELEASE_STAGE", Rails.env)
  config.enabled_release_stages = %w[production]
  config.app_version = AppConfig.env("APP_VERSION")
  config.logger.level = Logger::ERROR unless config.api_key
end

# Initializers load in name order, so the filtered keys (filter_parameter_logging.rb) are added once all have run.
Rails.application.config.after_initialize do
  Bugsnag.configuration.redacted_keys.merge(Rails.application.config.filter_parameters.map { |key| key.is_a?(Regexp) ? key : /#{key}/i })
end
