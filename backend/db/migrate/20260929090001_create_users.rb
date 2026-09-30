class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :email, null: false
      t.string :name, null: false
      t.string :password_digest, null: false
      t.string :role, null: false
      t.boolean :active, null: false, default: true
      t.datetime :last_login_at
      t.timestamps
    end
    add_index :users, "lower(email)", unique: true, name: "index_users_on_lower_email"
    add_check_constraint :users, "role IN ('admin', 'warehouse_manager')", name: "users_role_valid"
  end
end
