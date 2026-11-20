# Alerts about the Deere portal sync (SecurePortalSyncJob) for the people who look after it (User.deere_sync_recipients:
# admins and the users ticked in Users → Permissions): an item in their notification bell (read from the audit log by
# Activity::Feed; it opens the Deere sync popup), one email (PortalSyncMailer) and a Slack post (SlackNotifier; its link
# opens the popup too). Never raises: an alert that cannot be sent must not stop the sync.
module PortalAlerts
  EVENTS = {
    otp_needed: "portal_sync.otp_needed",
    otp_timed_out: "portal_sync.otp_timed_out",
    failed: "portal_sync.failed"
  }.freeze

  module_function

  # Deere asks for the SMS OTP; the sync waits for it until `expires_at`.
  def otp_needed(message:, expires_at:)
    deliver(:otp_needed, message: message, expires_at: expires_at.utc.iso8601)
  end

  # Nobody entered the OTP in time: the sync stopped.
  def otp_timed_out
    deliver(:otp_timed_out, message: "Nobody entered the SMS code within #{OtpHandoff::WAIT_TIMEOUT / 60} minutes, so the sync stopped. " \
                                     "It asks again at the next run (08:00 IST) or when someone clicks Sync again.")
  end

  # The sync failed (`error`), or a business's file could not be downloaded or uploaded (`results` with status failed).
  def failed(error: nil, results: [])
    lines = results.select { |r| r[:status] == "failed" }.map { |r| "#{Business.label(r[:business])}: #{r[:message]}" }
    deliver(:failed, message: [ error, *lines ].compact_blank.join("\n").presence || "The sync failed.")
  end

  SLACK_TITLES = { otp_needed: "John Deere", otp_timed_out: "John Deere sync stopped: no OTP entered", failed: "John Deere sync failed" }.freeze

  # The app with the John Deere sync popup open (the OTP box while the sync waits for the code).
  def popup_url
    "#{AppConfig.app_url.chomp('/')}/?deere_sync=1"
  end

  def deliver(kind, **details)
    begin
      AuditLog.record(EVENTS.fetch(kind), **details)
    rescue StandardError => e
      Rails.logger.error("[portal_alerts] #{kind}: bell item not saved: #{e.class}: #{e.message}")
    end
    post_to_slack(kind, details[:message])

    recipients = User.deere_sync_recipients.order(:id).pluck(:email)
    if recipients.empty?
      Rails.logger.warn("[portal_alerts] #{kind}: nobody to email")
      return
    end
    PortalSyncMailer.with(kind: kind.to_s, recipients: recipients, **details).alert.deliver_now
    Rails.logger.info("[portal_alerts] #{kind}: emailed #{recipients.size} people")
  rescue StandardError => e
    Rails.logger.error("[portal_alerts] #{kind}: email not sent: #{e.class}: #{e.message}")
  end

  # SlackNotifier never raises.
  def post_to_slack(kind, message)
    slack = SlackNotifier.new
    if kind == :otp_needed
      slack.notify_otp_required(SLACK_TITLES[kind], message, url: popup_url)
    else
      slack.notify_failure(SLACK_TITLES[kind], "#{message}\n<#{popup_url}|Open the John Deere sync>")
    end
  end
end
