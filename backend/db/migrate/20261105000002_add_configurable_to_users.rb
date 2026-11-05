# Each user's own settings of the app (User#configurable), e.g. "orders_columns": the Orders table columns they show
# (column keys; not set: the default columns).
class AddConfigurableToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :configurable, :jsonb, default: {}, null: false
  end
end
