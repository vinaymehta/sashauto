module Cache
  # Deletes expired cache files (config.cache_store is a file store that never removes old entries on its own: each upload
  # and each dispatch mark leaves the figures of the old data behind). Started by sidekiq-cron every night
  # (config/schedule.yml).
  class CleanupJob < ApplicationJob
    queue_as :default

    def perform
      Rails.cache.cleanup if Rails.cache.respond_to?(:cleanup)
    end
  end
end
