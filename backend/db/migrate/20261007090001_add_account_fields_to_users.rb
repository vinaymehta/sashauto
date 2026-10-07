# Admin user management: accounts created in the app get an emailed password that must be changed at first
# sign-in (`must_change_password`). `password_changed_at` signs a user out everywhere when their password is
# reset (sessions authenticated before it are rejected). `created_by` records which admin added the account.
class AddAccountFieldsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :must_change_password, :boolean, null: false, default: false
    add_column :users, :password_changed_at, :datetime
    add_reference :users, :created_by, foreign_key: { to_table: :users }
  end
end
