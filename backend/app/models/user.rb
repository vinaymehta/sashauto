class User < ApplicationRecord
  ROLES = %w[admin warehouse_manager].freeze

  has_secure_password

  normalizes :email, with: ->(email) { email.strip.downcase }

  validates :name, presence: true
  validates :email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :email, uniqueness: { case_sensitive: false }
  validates :role, inclusion: { in: ROLES }
  validates :password, length: { minimum: 12 }, allow_nil: true

  scope :active, -> { where(active: true) }
  scope :admins, -> { where(role: "admin") }

  def admin?
    role == "admin"
  end
end
