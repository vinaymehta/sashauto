# One business setting edited on the Settings page (AppSetting::DEFINITIONS lists them). AppConfig reads a setting
# before .env, so a value saved here replaces the .env value without a restart; blank falls back to .env.
class AppSetting < ApplicationRecord
  belongs_to :updated_by, class_name: "User", optional: true

  # default: what applies when neither the page nor .env has a value (shown on the page).
  Definition = Data.define(:key, :label, :group, :kind, :hint, :options, :default)
  def self.define(key, label, group, kind: :text, hint: nil, options: nil, default: nil)
    Definition.new(key: key, label: label, group: group, kind: kind, hint: hint, options: options, default: default)
  end
  private_class_method :define

  CURRENCIES = %w[USD EUR INR GBP].freeze

  # Every setting the page shows, in page order. kind: text, textarea (address lines), secret (never sent back to the
  # browser), select (options).
  DEFINITIONS = [
    define("COMPANY_NAME", "Company name", "Company", hint: "On purchase orders, Intimation Letters and emails"),
    define("COMPANY_ADDRESS", "Address", "Company", kind: :textarea, hint: "Delivery and invoice address on purchase orders"),
    define("COMPANY_GST", "GSTIN", "Company"),
    define("COMPANY_PHONE", "Phone", "Company"),
    define("COMPANY_EMAIL", "Email", "Company"),
    define("COMPANY_REGISTERED_OFFICE", "Registered office", "Company", kind: :textarea, hint: "Footer of the Intimation Letter"),
    define("COMPANY_TERMS_URL", "Terms and conditions URL", "Company", hint: "Linked on purchase orders"),
    define("INTIMATION_RCMC_COUNCIL", "Export promotion council", "Intimation Letter", hint: "e.g. EEPC INDIA"),
    define("INTIMATION_RCMC_NO", "RCMC number", "Intimation Letter"),
    define("INTIMATION_RCMC_DATE", "RCMC date", "Intimation Letter", hint: "As printed, e.g. 01/04/2026"),
    define("INTIMATION_EXPORT_DAYS", "Export within (days)", "Intimation Letter"),
    define("INTIMATION_SIGNATORY_NAME", "Signatory name", "Intimation Letter"),
    define("INTIMATION_SIGNATORY_TITLE", "Signatory title", "Intimation Letter"),
    define("ADMIN_NOTIFICATION_EMAILS", "Alert email recipients", "Notifications",
           hint: "Comma-separated. Blank: every active admin"),
    define("DEFAULT_SHIP_TO", "Default Ship To (DTP)", "Notifications", hint: "DTP orders shipped anywhere else are flagged and emailed",
           default: AppConfig::DEFAULT_SHIP_TOS["dtp"]),
    define("DEFAULT_SHIP_TO_GMBH", "Default Ship To (GMBH)", "Notifications", hint: "GMBH orders shipped anywhere else are flagged and emailed",
           default: AppConfig::DEFAULT_SHIP_TOS["gmbh"]),
    define("SLACK_WEBHOOK_URL", "Slack webhook URL", "Notifications", kind: :secret, hint: "Portal OTP requests and failures"),
    define("SECURE_PORTAL_USERNAME", "Deere portal username", "Deere portal"),
    define("SECURE_PORTAL_PASSWORD", "Deere portal password", "Deere portal", kind: :secret),
    define("PORTAL_SUPPLIER_DTP", "DTP supplier in the portal", "Deere portal",
           hint: "Supplier number (or part of the name) of the portal's Supplier option to download for DTP",
           default: "0000383803 (SASH Autotech, Inc. - Wood Dale, IL)"),
    define("PORTAL_SUPPLIER_GMBH", "GMBH supplier in the portal", "Deere portal",
           hint: "Supplier number (or part of the name) of the portal's Supplier option to download for GMBH",
           default: "0000372699 (SASH AUTOTECH PVT LIMITED - FARIDABAD)"),
    define("CURRENCY_DTP", "DTP currency", "Businesses", kind: :select, options: CURRENCIES, hint: "Currency of DTP's Deere Unit Price",
           default: "USD"),
    define("CURRENCY_GMBH", "GMBH currency", "Businesses", kind: :select, options: CURRENCIES, hint: "Currency of GMBH's Deere Unit Price",
           default: "USD")
  ].freeze
  KEYS = DEFINITIONS.map(&:key).freeze
  CACHE_KEY = "app_settings/v1".freeze

  validates :key, inclusion: { in: KEYS }, uniqueness: true

  after_commit { Rails.cache.delete(CACHE_KEY) }

  # key => value of every saved setting (cached; cleared on save).
  def self.values
    Rails.cache.fetch(CACHE_KEY, expires_in: 10.minutes) { where.not(value: [ nil, "" ]).pluck(:key, :value).to_h }
  end

  # The saved value, or nil (then .env applies). Never fails: without the table (e.g. before migrating) it is nil.
  def self.[](key)
    values[key]
  rescue ActiveRecord::ActiveRecordError, PG::Error
    nil
  end
end
