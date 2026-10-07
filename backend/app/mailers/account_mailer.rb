# Sign-in details for an account an admin created or reset. Sent with deliver_now from the request (never
# queued), so the password is never written to Redis/Sidekiq; the user must choose their own at first sign-in.
class AccountMailer < ApplicationMailer
  def credentials
    @user = params.fetch(:user)
    @password = params.fetch(:password)
    @reset = params.fetch(:reset, false)
    @login_url = "#{AppConfig.app_url}/login"
    subject = @reset ? "Your SASH portal password was reset" : "Your SASH portal account"
    mail(to: @user.email, subject: subject)
  end
end
