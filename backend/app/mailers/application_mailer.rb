class ApplicationMailer < ActionMailer::Base
  default from: -> { AppConfig.mail_from }
  layout "mailer"
  helper QuantityFormatHelper

  # The SASH logo in the email header, embedded in the message (no external image to load or block).
  LOGO = Rails.root.join("app/assets/images/sash-logo-email.png").binread.freeze
  before_action { attachments.inline["sash-logo.png"] = LOGO }
end
