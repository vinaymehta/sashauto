class ApplicationMailer < ActionMailer::Base
  default from: -> { AppConfig.mail_from }
  layout "mailer"
  helper QuantityFormatHelper
end
