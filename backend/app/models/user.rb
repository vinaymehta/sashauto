class User < ApplicationRecord
  # Employee: no access until an admin gives it permissions.
  ROLES = %w[admin warehouse_manager employee].freeze
  MINIMUM_PASSWORD_LENGTH = 12

  # Sections of the app a user can be given: none (hidden), view (see, change nothing) or edit. Users and their
  # permissions are managed by admins only; admins always have edit everywhere.
  SECTIONS = %w[dashboard orders products vendors settings].freeze
  LEVELS = %w[none view edit].freeze
  # A section not set for a user: what the role had before permissions (the Warehouse Manager sees the Orders and sets
  # its own delivery marks).
  ROLE_DEFAULTS = { "warehouse_manager" => { "orders" => "view" } }.freeze

  has_secure_password

  belongs_to :created_by, class_name: "User", optional: true

  normalizes :email, with: ->(email) { email.strip.downcase }

  validates :name, presence: true, length: { maximum: 200 }
  validates :email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :email, uniqueness: { case_sensitive: false }
  validates :role, inclusion: { in: ROLES }
  validate :permissions_valid
  validates :password, length: { minimum: MINIMUM_PASSWORD_LENGTH }, allow_nil: true
  validate :password_strength, if: -> { password.present? }

  # Sessions authenticated before this moment are no longer valid (see ApplicationController#session_user).
  before_save -> { self.password_changed_at = Time.current }, if: :will_save_change_to_password_digest?

  scope :active, -> { where(active: true) }
  scope :admins, -> { where(role: "admin") }

  def admin?
    role == "admin"
  end

  # "none", "view" or "edit" for a section (User::SECTIONS).
  def permission(section)
    return "edit" if admin?

    LEVELS.include?(permissions[section.to_s]) ? permissions[section.to_s] : ROLE_DEFAULTS.dig(role, section.to_s) || "none"
  end

  # True when the user's level for the section is at least `level` ("view" or "edit").
  def can?(section, level = "view")
    LEVELS.index(permission(section)) >= LEVELS.index(level.to_s)
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
end
