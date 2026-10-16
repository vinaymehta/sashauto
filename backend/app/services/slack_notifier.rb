# Posts alerts to the team's Slack channel through an Incoming Webhook (SLACK_WEBHOOK_URL). Without the URL the
# alert is only logged, so nothing breaks before Slack is set up. Never raises.
class SlackNotifier
  def initialize(webhook_url = AppConfig.slack_webhook_url)
    @notifier = Slack::Notifier.new(webhook_url) if webhook_url
  end

  # The Deere portal job is waiting for the SMS code; `url` opens the page where an admin enters it.
  def notify_otp_required(label, message, url: nil)
    post(":iphone: *OTP needed: #{label}*\n#{message}#{"\n<#{url}|Enter the code>" if url}")
  end

  def notify_failure(label, message)
    post(":warning: *#{label}*\n#{message}")
  end

  private

  def post(text)
    unless @notifier
      Rails.logger.info("[slack] SLACK_WEBHOOK_URL not set, not posted: #{text}")
      return false
    end

    @notifier.ping(text)
    true
  rescue StandardError => e
    Rails.logger.warn("[slack] post failed: #{e.class}: #{e.message}")
    false
  end
end
