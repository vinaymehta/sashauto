# The Orders list's File column moves to the end. Users who chose their own columns get it moved there once (where they
# show it); after that they can drag it anywhere again and their order is kept.
class MoveFileColumnLastInSavedOrdersColumns < ActiveRecord::Migration[8.1]
  def up
    User.where("configurable ? 'orders_columns'").find_each do |user|
      shown = Array(user.configurable["orders_columns"])
      next unless shown.include?("file") && shown.last != "file"

      user.update_columns(configurable: user.configurable.merge("orders_columns" => (shown - [ "file" ]) + [ "file" ]))
    end
  end

  def down
    # The users' earlier place for File is not known; they can move it back by dragging.
  end
end
