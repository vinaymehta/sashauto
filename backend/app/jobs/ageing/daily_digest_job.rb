module Ageing
  # Run by sidekiq-cron every day at 09:00 (config/schedule.yml).
  class DailyDigestJob < ApplicationJob
    queue_as :default

    def perform
      today = Time.find_zone!(AppConfig.ageing_time_zone).today
      result = Ageing::DigestBuilder.call(mode: "scheduled", today: today)
      Rails.logger.info("[ageing] daily digest for #{today}: #{result.to_h}")
    end
  end
end
