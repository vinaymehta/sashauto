# Resend API delivery (ActionMailer delivery method :resend), the only way emails are sent.
# RESEND_API_KEY is required in production; in development without it, emails go to tmp/mails.
Resend.api_key = AppConfig.resend_api_key if AppConfig.resend_api_key
