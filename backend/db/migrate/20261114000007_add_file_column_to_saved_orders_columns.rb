# Orders gets a File column (latest Deere file, or the old file a kept order comes from). Users who chose their own
# columns get it once, right after Type (or first when they do not show Type); they can hide it again in Columns.
class AddFileColumnToSavedOrdersColumns < ActiveRecord::Migration[8.1]
  def up
    User.where("configurable ? 'orders_columns'").find_each do |user|
      shown = Array(user.configurable["orders_columns"])
      next if shown.include?("file")

      at = shown.index("type")
      shown = at ? shown.dup.insert(at + 1, "file") : [ "file", *shown ]
      user.update_columns(configurable: user.configurable.merge("orders_columns" => shown))
    end
  end

  def down
    User.where("configurable ? 'orders_columns'").find_each do |user|
      user.update_columns(configurable: user.configurable.merge("orders_columns" => Array(user.configurable["orders_columns"]) - [ "file" ]))
    end
  end
end
