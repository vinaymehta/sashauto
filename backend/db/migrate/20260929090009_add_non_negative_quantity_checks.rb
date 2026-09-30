class AddNonNegativeQuantityChecks < ActiveRecord::Migration[8.1]
  def change
    add_check_constraint :order_snapshot_rows,
                         "(qty IS NULL OR qty >= 0) AND (previous_qty IS NULL OR previous_qty >= 0) AND (effective_qty IS NULL OR effective_qty >= 0)",
                         name: "order_snapshot_rows_quantities_non_negative"
  end
end
