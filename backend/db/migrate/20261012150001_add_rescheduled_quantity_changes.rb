# A quantity moved to another Ship Date of the same PO line (one date emptied, a new date with the same Qty) is one
# "rescheduled" change (difference 0) with the old date in previous_ship_date, counted apart from Qty changes.
class AddRescheduledQuantityChanges < ActiveRecord::Migration[8.1]
  def up
    add_column :quantity_changes, :previous_ship_date, :date
    add_column :upload_batches, :rescheduled_count, :integer
    remove_check_constraint :quantity_changes, name: "quantity_changes_difference_valid"
    remove_check_constraint :quantity_changes, name: "quantity_changes_direction_valid"
    add_check_constraint :quantity_changes,
                         "difference = new_qty - old_qty AND (difference <> 0 OR direction IN ('added', 'removed', 'rescheduled'))",
                         name: "quantity_changes_difference_valid"
    add_check_constraint :quantity_changes,
                         "(direction = 'increase' AND difference > 0) OR (direction = 'decrease' AND difference < 0) " \
                         "OR (direction = 'added' AND old_qty = 0) OR (direction = 'removed' AND new_qty = 0) " \
                         "OR (direction = 'rescheduled' AND difference = 0 AND previous_ship_date IS NOT NULL)",
                         name: "quantity_changes_direction_valid"
  end

  def down
    remove_check_constraint :quantity_changes, name: "quantity_changes_difference_valid"
    remove_check_constraint :quantity_changes, name: "quantity_changes_direction_valid"
    add_check_constraint :quantity_changes,
                         "difference = new_qty - old_qty AND (difference <> 0 OR direction IN ('added', 'removed'))",
                         name: "quantity_changes_difference_valid"
    add_check_constraint :quantity_changes,
                         "(direction = 'increase' AND difference > 0) OR (direction = 'decrease' AND difference < 0) " \
                         "OR (direction = 'added' AND old_qty = 0) OR (direction = 'removed' AND new_qty = 0)",
                         name: "quantity_changes_direction_valid"
    remove_column :upload_batches, :rescheduled_count
    remove_column :quantity_changes, :previous_ship_date
  end
end
