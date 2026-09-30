# Resend API delivery (ActionMailer delivery method :resend). Active only when RESEND_API_KEY is set;
# otherwise mail falls back to SMTP (or files in development). See AppConfig.mail_delivery_method.
Resend.api_key = AppConfig.env("RESEND_API_KEY") if AppConfig.env("RESEND_API_KEY")
