# Deere portal sync failure alerts (PortalAlerts): nobody entered the SMS OTP in time, or the sync failed. One email to
# everyone who gets the alerts; its button opens the app with the Deere sync popup (Sync again, then the OTP box).
class PortalSyncMailer < ApplicationMailer
  SUBJECTS = {
    "otp_timed_out" => "John Deere sync stopped: no OTP entered",
    "failed" => "John Deere sync failed"
  }.freeze

  def alert
    @kind = params.fetch(:kind)
    @title = SUBJECTS.fetch(@kind)
    @message = params[:message].to_s
    zone = Time.find_zone!(AppConfig.ageing_time_zone)
    @at = zone.now
    @url = PortalAlerts.popup_url
    mail(to: params.fetch(:recipients), subject: @title)
  end
end
