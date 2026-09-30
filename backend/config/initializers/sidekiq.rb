Sidekiq.configure_server do |config|
  config.redis = { url: AppConfig.redis_url }
end

Sidekiq.configure_client do |config|
  config.redis = { url: AppConfig.redis_url }
end
