# Quantity changes also record rows added in an upload (old Qty 0) and rows no longer present (new Qty 0), whose
# difference may be 0 (a blank-Qty placeholder).
class AddAddedRemovedQuantityChanges < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :quantity_changes, name: "quantity_changes_difference_valid"
    remove_check_constraint :quantity_changes, name: "quantity_changes_direction_valid"
    add_check_constraint :quantity_changes,
                         "difference = new_qty - old_qty AND (difference <> 0 OR direction IN ('added', 'removed'))",
                         name: "quantity_changes_difference_valid"
    add_check_constraint :quantity_changes,
                         "(direction = 'increase' AND difference > 0) OR (direction = 'decrease' AND difference < 0) " \
                         "OR (direction = 'added' AND old_qty = 0) OR (direction = 'removed' AND new_qty = 0)",
                         name: "quantity_changes_direction_valid"
  end

  def down
    remove_check_constraint :quantity_changes, name: "quantity_changes_difference_valid"
    remove_check_constraint :quantity_changes, name: "quantity_changes_direction_valid"
    add_check_constraint :quantity_changes, "difference = new_qty - old_qty AND difference <> 0",
                         name: "quantity_changes_difference_valid"
    add_check_constraint :quantity_changes,
                         "(direction = 'increase' AND difference > 0) OR (direction = 'decrease' AND difference < 0)",
                         name: "quantity_changes_direction_valid"
  end
end
