# Deleting a user (admin) keeps the row for the history that refers to it (uploads, audit log, deliveries, vendor
# orders) but hides it, blocks sign-in and frees the email address.
class AddDeletedAtToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :deleted_at, :datetime
  end
end
