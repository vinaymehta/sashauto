class User < ApplicationRecord
  # Employee: no access until an admin gives it permissions.
  ROLES = %w[admin warehouse_manager employee].freeze
  MINIMUM_PASSWORD_LENGTH = 12

  # Sections of the app a user can be given: none (hidden), view (see, change nothing) or edit. Users and their
  # permissions are managed by admins only; admins always have edit everywhere.
  SECTIONS = %w[dashboard orders products vendors settings].freeze
  LEVELS = %w[none view edit].freeze
  # A section not set for a user (every non-admin role): everything enabled except Admin Settings — the Dashboard to see
  # (nothing on it to edit), Orders, Products and Vendors to see and change. An admin changes it per user (Users →
  # Permissions).
  DEFAULT_PERMISSIONS = { "dashboard" => "view", "orders" => "edit", "products" => "edit", "vendors" => "edit", "settings" => "none" }.freeze

  has_secure_password

  belongs_to :created_by, class_name: "User", optional: true

  normalizes :email, with: ->(email) { email.strip.downcase }

  validates :name, presence: true, length: { maximum: 200 }
  validates :email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :email, uniqueness: { case_sensitive: false }
  validates :role, inclusion: { in: ROLES }
  validate :permissions_valid
  validate :configurable_valid
  validates :password, length: { minimum: MINIMUM_PASSWORD_LENGTH }, allow_nil: true
  validate :password_strength, if: -> { password.present? }

  # Sessions authenticated before this moment are no longer valid (see ApplicationController#session_user).
  before_save -> { self.password_changed_at = Time.current }, if: :will_save_change_to_password_digest?
  # A new admin gets the Deere sync alerts until someone unticks them (Users → Permissions).
  before_create -> { self.deere_sync_alerts = true }, if: :admin?

  scope :active, -> { where(active: true) }
  scope :admins, -> { where(role: "admin") }
  # Get the Deere portal sync alerts (#deere_sync_alerts?): the active users ticked for them, admins included.
  scope :deere_sync_recipients, -> { active.where(deleted_at: nil, deere_sync_alerts: true) }

  def admin?
    role == "admin"
  end

  # Gets the Deere portal sync alerts (OTP timed out, sync failed): the popup in the app, the bell and an email
  # (PortalAlerts). Any user an admin ticks it for (Users → Permissions), admins too; a new admin starts ticked.
  def deere_sync_alerts?
    self[:deere_sync_alerts]
  end

  # "none", "view" or "edit" for a section (User::SECTIONS).
  def permission(section)
    return "edit" if admin?

    LEVELS.include?(permissions[section.to_s]) ? permissions[section.to_s] : DEFAULT_PERMISSIONS.fetch(section.to_s, "none")
  end

  # True when the user's level for the section is at least `level` ("view" or "edit").
  def can?(section, level = "view")
    LEVELS.index(permission(section)) >= LEVELS.index(level.to_s)
  end

  # The Orders table columns this user shows (column keys), nil until they choose (then the default columns).
  def orders_columns
    configurable["orders_columns"]
  end

  # Column keys each other table shows, by table name ("products", "vendors", …); a table not in it shows its defaults.
  def table_columns
    configurable.fetch("table_columns", {})
  end

  # Every section with the level in effect.
  def effective_permissions
    SECTIONS.to_h { |section| [ section, permission(section) ] }
  end

  # Character rules every new password must meet (besides the minimum length); mirrored in the frontend
  # (lib/password.ts) so the form shows them as the user types.
  PASSWORD_RULES = {
    "an uppercase letter" => /[A-Z]/,
    "a lowercase letter" => /[a-z]/,
    "a number" => /\d/
  }.freeze

  # A random password for an account an admin creates or resets (emailed to the user, changed at first sign-in).
  # Meets PASSWORD_RULES.
  def self.generate_password
    loop do
      password = SecureRandom.alphanumeric(16)
      return password if PASSWORD_RULES.each_value.all? { |rule| rule.match?(password) }
    end
  end

  private

  def password_strength
    missing = PASSWORD_RULES.reject { |_, rule| rule.match?(password) }.keys
    errors.add(:password, "must include #{missing.to_sentence}") if missing.any?
    errors.add(:password, "must not start or end with a space") if password != password.strip
  end

  private

  def permissions_valid
    unless permissions.is_a?(Hash) && permissions.all? { |section, level| SECTIONS.include?(section) && LEVELS.include?(level) }
      errors.add(:permissions, "must give each section (#{SECTIONS.join(', ')}) one of #{LEVELS.join(', ')}")
    end
  end

  # The user's own settings: orders_columns (the Orders table) and table_columns (every other table, by name): each a list
  # of 1 to 300 column keys (each a short text), or not set.
  def configurable_valid
    unless configurable.is_a?(Hash) && (configurable.keys - %w[orders_columns table_columns]).empty? &&
           (!configurable.key?("orders_columns") || column_keys?(configurable["orders_columns"])) &&
           (!configurable.key?("table_columns") || (configurable["table_columns"].is_a?(Hash) && configurable["table_columns"].size <= 100 &&
             configurable["table_columns"].all? { |table, keys| table.is_a?(String) && table.match?(/\A[a-z0-9_]{1,60}\z/) && column_keys?(keys) }))
      errors.add(:configurable, "must hold orders_columns and table_columns, each a list of 1 to 300 column keys")
    end
  end

  def column_keys?(shown)
    shown.is_a?(Array) && shown.size.between?(1, 300) && shown.all? { |key| key.is_a?(String) && key.present? && key.size <= 200 }
  end
end
