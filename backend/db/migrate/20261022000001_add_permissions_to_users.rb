# Per-user access to each section of the app (Users → a user → Permissions): { "orders" => "edit", "products" => "view", … }.
# Admins always have full access; a section left out falls back to the role's default (User::ROLE_DEFAULTS).
class AddPermissionsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :permissions, :jsonb, null: false, default: {}
  end
end
