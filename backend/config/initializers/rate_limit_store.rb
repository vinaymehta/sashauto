# Counters for controller `rate_limit` must be shared by every Puma process, so they live in the
# Redis instance Sidekiq already requires. This is not used as an application cache.
RATE_LIMIT_STORE = ActiveSupport::Cache::RedisCacheStore.new(url: AppConfig.redis_url, namespace: "rate-limit")
