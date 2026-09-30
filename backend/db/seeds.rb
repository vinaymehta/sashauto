# Login accounts for development. Safe to run repeatedly (bin/rails db:seed).
#
# Default passwords are for local development only. In production the passwords must be
# supplied through SEED_ADMIN_PASSWORD / SEED_MANAGER_PASSWORD, or seeding is refused.

accounts = [
  { email: ENV.fetch("SEED_ADMIN_EMAIL", "admin@example.com"), name: "Admin User", role: "admin",
    password: ENV["SEED_ADMIN_PASSWORD"], dev_password: "Admin@12345678" },
  { email: ENV.fetch("SEED_MANAGER_EMAIL", "manager@example.com"), name: "Warehouse Manager", role: "warehouse_manager",
    password: ENV["SEED_MANAGER_PASSWORD"], dev_password: "Manager@12345678" }
]

accounts.each do |account|
  password = account[:password].presence
  if password.nil?
    abort "Set SEED_ADMIN_PASSWORD and SEED_MANAGER_PASSWORD to seed users in production." if Rails.env.production?
    password = account[:dev_password]
  end

  user = User.find_or_initialize_by(email: account[:email].strip.downcase)
  created = user.new_record?
  user.assign_attributes(name: account[:name], role: account[:role], password: password, active: true)
  user.save!
  AuditLog.record(created ? "user.created" : "user.updated", subject: user, role: user.role, via: "seed")
  puts "#{created ? 'Created' : 'Updated'} #{user.role}: #{user.email}"
end
