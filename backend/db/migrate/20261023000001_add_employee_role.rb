# A third role, Employee: no access until an admin gives it permissions (Users → a user → Permissions).
class AddEmployeeRole < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :users, name: "users_role_valid"
    add_check_constraint :users, "role IN ('admin', 'warehouse_manager', 'employee')", name: "users_role_valid"
  end

  def down
    remove_check_constraint :users, name: "users_role_valid"
    add_check_constraint :users, "role IN ('admin', 'warehouse_manager')", name: "users_role_valid"
  end
end
