# Central place for environment-driven settings. Blank values (e.g. `RESEND_FROM=` in .env) count as unset.
module AppConfig
  module_function

  def env(name, default = nil)
    ENV[name].presence || default
  end

  # A business setting: the value saved on the Settings page (AppSetting), else .env, else `default`. Inside
  # with_settings (a preview of unsaved values) its value there comes first.
  def setting(name, default = nil)
    overrides = Thread.current[:app_config_overrides]
    return overrides[name].presence || default if overrides&.key?(name)

    AppSetting[name].presence || env(name, default)
  end

  # Runs the block with these setting values instead of the saved ones (blank = the default), e.g. to preview a
  # purchase order with wording not saved yet.
  def with_settings(values)
    previous = Thread.current[:app_config_overrides]
    Thread.current[:app_config_overrides] = (previous || {}).merge(values.to_h.transform_keys(&:to_s))
    yield
  ensure
    Thread.current[:app_config_overrides] = previous
  end

  # A setting that must come from the environment (.env) in production. The local default is used only
  # in development/test, so a missing value can never silently point a server at localhost.
  def required(name, local_default)
    value = ENV[name].presence
    return value if value
    raise KeyError, "#{name} must be set in the environment (see backend/.env.example)" if Rails.env.production?
    local_default
  end

  def redis_url
    required("REDIS_URL", "redis://localhost:6379/0")
  end

  # Sender of every email: an address on the domain verified in Resend.
  def mail_from
    required("RESEND_FROM", "order-tracker@localhost")
  end

  # Comma-separated. When blank, notifications go to every active Admin user.
  # SASH (the buyer) on vendor purchase order PDFs: header, delivery and invoice address.
  # Purchase order wording (Admin Settings → Purchase Order, a WYSIWYG editor), as HTML (VendorOrders::RichText; wording
  # saved before the editor, in plain text, is read too). {company} / {terms_url} are filled in; a paragraph with
  # {terms_url} is left out without one.
  #
  # The Terms and Conditions at the foot of the Standard format PO.
  PO_TERMS_DEFAULT = <<~HTML.squish
    <p><strong>PLEASE SUPPLY THE ABOVE GOODS AND QUOTE THIS PURCHASE ORDER NUMBER WITH YOUR DELIVERY AND INVOICE. DELIVERIES WITHOUT THIS NUMBER MAY BE REFUSED.</strong></p>
    <p><strong>Subject to {company}'s Terms and Conditions of Purchase</strong></p>
    <p>This order is issued under, and governed by:</p>
    <p>(a) the terms of any written supply agreement in force between {company} and the Supplier for the goods or services on this order; or</p>
    <p>(b) where there is no such agreement, {company}'s Terms and Conditions of Purchase in effect on the date of this order, together with any special conditions or attachments referred to in this order.</p>
    <p>The Terms and Conditions of Purchase are available at {terms_url}.</p>
    <p>By supplying the goods or services on this order, the Supplier accepts the terms that apply to it.</p>
    <p>Terms printed on the Supplier's quotation, invoice, delivery note or other documents do not apply unless {company} agrees to them in writing.</p>
  HTML
  # The numbered Requirements on the SASH format PO (Indian vendors) and, kept apart, on the overseas PO.
  EXPORT_PO_REQUIREMENTS_DEFAULT = <<~HTML.squish
    <ol>
    <li><p>All parts should be without any marking of <u>OE Logo / OE Name / Supplier Logo / Supplier Part No.</u></p></li>
    <li><p>Please supply quantities strictly as per this purchase order. Any dispatch of excess quantities must be approved by {company} in writing otherwise material will be returned at your cost.</p></li>
    <li><p>SASH part no. to be labelled. If packed in carton then quantity to be mentioned on the carton.</p></li>
    <li><p>It is mandatory to share PDI first, pickup will be done after the report is approved by quality team.</p></li>
    <li><p>Company will not be responsible for the rejected material after one week, after notification.</p></li>
    <li><p>All disputes are settled within Faridabad jurisdiction.</p></li>
    <li><p><mark><strong>PO number must be mentioned on your Tax Invoice</strong></mark></p></li>
    </ol>
  HTML
  # The notices at the foot of the SASH format PO and, kept apart, the overseas PO: the first beside the PAN, the others
  # across the page.
  PO_NOTICES_DEFAULT = <<~HTML.squish
    <p><mark><strong>All parts supplied by you must be Lead Free (this includes powder coating &amp; paint also) and Asbestos free.</strong></mark></p>
    <p><mark><strong>Any Pallet/Skids MUST be of plywood/ pinewood. Pinewood with fumigation. No Jungle wood to be used for any skid / pallet.</strong></mark></p>
  HTML
  # Terms of Delivery and the payment terms (when the vendor has none) on the SASH format PO.
  PO_DELIVERY_TERMS_DEFAULT = "Supplies to be made by charging as per GST rule".freeze
  PO_PAYMENT_TERMS_DEFAULT = "30 days from date of Dispatch".freeze
  # The PO layout for Indian vendors: "sash" (SASH's form, VendorOrders::IndiaPdfBuilder) or "standard" (PdfBuilder).
  PO_FORMATS = %w[sash standard].freeze

  def po_terms = setting("PO_TERMS", PO_TERMS_DEFAULT)

  # SASH format PO (Indian vendors).
  def india_po_requirements = setting("INDIA_PO_REQUIREMENTS", EXPORT_PO_REQUIREMENTS_DEFAULT)

  def india_po_notices = setting("INDIA_PO_NOTICES", PO_NOTICES_DEFAULT)

  # Overseas PO.
  def export_po_requirements = setting("EXPORT_PO_REQUIREMENTS", EXPORT_PO_REQUIREMENTS_DEFAULT)

  def export_po_notices = setting("EXPORT_PO_NOTICES", PO_NOTICES_DEFAULT)

  def po_delivery_terms = setting("PO_DELIVERY_TERMS", PO_DELIVERY_TERMS_DEFAULT)

  def po_payment_terms = setting("PO_PAYMENT_TERMS", PO_PAYMENT_TERMS_DEFAULT)

  def po_format
    value = setting("PO_FORMAT", "sash").to_s.downcase
    PO_FORMATS.include?(value) ? value : "sash"
  end

  # SASH's CIN and PAN (from its purchase orders), unless set in Admin Settings.
  COMPANY_DEFAULTS = { cin: "U35123DL209PTC188497", pan: "AAMCS8709B" }.freeze

  def company
    {
      name: setting("COMPANY_NAME", "SASH Autotech Pvt. Ltd."),
      address: setting("COMPANY_ADDRESS", ""),
      gst: setting("COMPANY_GST", ""),
      phone: setting("COMPANY_PHONE", ""),
      email: setting("COMPANY_EMAIL", ""),
      terms_url: setting("COMPANY_TERMS_URL", ""),
      cin: setting("COMPANY_CIN", COMPANY_DEFAULTS[:cin]),
      pan: setting("COMPANY_PAN", COMPANY_DEFAULTS[:pan])
    }
  end

  # Where a business's orders are normally shipped; rows with any other Ship To are flagged and emailed (Orders::ShipTo).
  DEFAULT_SHIP_TOS = {
    "dtp" => "XPAC, 824 E 8TH ST, MILAN, IL 612643110",
    "gmbh" => "John Deere GmbH & Co. KG, John-Deere-Strasse 2, Bruchsal, 08 76646"
  }.freeze

  def default_ship_to(business = "dtp")
    business = business.to_s
    setting(business == "dtp" ? "DEFAULT_SHIP_TO" : "DEFAULT_SHIP_TO_#{business.upcase}", DEFAULT_SHIP_TOS[business])
  end

  def admin_notification_emails
    setting("ADMIN_NOTIFICATION_EMAILS", "").split(",").map(&:strip).reject(&:empty?)
  end

  # Public URL of the frontend (what users open in the browser), used for links in emails.
  def app_url
    required("APP_URL", "http://localhost:3000")
  end

  # True when the app is served over HTTPS (APP_URL starts with https://). Production then redirects to
  # HTTPS and sends the session cookie only over HTTPS; on plain http:// both are off, or login would fail.
  def https?
    URI(app_url).scheme == "https"
  end

  # Time zone whose calendar day the ageing email (sent with each upload) uses.
  def ageing_time_zone
    env("AGEING_TIME_ZONE", "Asia/Kolkata")
  end

  # Public URL of this backend (pages it renders itself, e.g. /otp_requests), used for the Slack OTP link.
  # Not APP_URL: that is the frontend, which only forwards /api to the backend.
  def backend_public_url
    required("BACKEND_PUBLIC_URL", "http://localhost:4000").chomp("/")
  end

  # Slack Incoming Webhook for alerts (the portal's OTP request and failures). Blank: alerts are only logged.
  def slack_webhook_url
    setting("SLACK_WEBHOOK_URL")
  end

  # Deere supplier portal login (SecurePortal).
  def portal_username
    setting("SECURE_PORTAL_USERNAME")
  end

  def portal_password
    setting("SECURE_PORTAL_PASSWORD")
  end

  # The portal's Supplier option to download for each business (its supplier number, or part of its name):
  # DTP = SASH Autotech, Inc. - Wood Dale, IL; GMBH = SASH AUTOTECH PVT LIMITED - FARIDABAD.
  PORTAL_SUPPLIERS = { "dtp" => "0000383803", "gmbh" => "0000372699" }.freeze

  def portal_supplier(business)
    setting("PORTAL_SUPPLIER_#{business.to_s.upcase}", PORTAL_SUPPLIERS[business.to_s])
  end

  # Currency of a business's Deere Unit Price.
  def business_currency(business)
    setting("CURRENCY_#{business.to_s.upcase}", "USD")
  end

  def max_upload_bytes
    Integer(env("MAX_UPLOAD_BYTES", 20.megabytes))
  end

  # Emails are sent only through the Resend API. Production requires RESEND_API_KEY; in development
  # without a key, emails are written to tmp/mails instead.
  def resend_api_key
    required("RESEND_API_KEY", nil)
  end

  # :resend when a Resend API key is configured, otherwise nil (development only: file delivery).
  def mail_delivery_method
    resend_api_key ? :resend : nil
  end
end
