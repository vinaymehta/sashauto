class AuditLog < ApplicationRecord
  belongs_to :user, optional: true

  def readonly?
    persisted?
  end

  def self.record(action, user: nil, subject: nil, ip: nil, **metadata)
    create!(action: action, user: user, subject_type: subject&.class&.name, subject_id: subject&.id,
            ip_address: ip, metadata: metadata)
  end
end
