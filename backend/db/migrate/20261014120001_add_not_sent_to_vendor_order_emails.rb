# Vendor orders get a PDF purchase order instead of an automatic email; the PDF is emailed only when an admin asks.
# New vendor orders start as "not_sent".
class AddNotSentToVendorOrderEmails < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :vendor_orders, name: "vendor_orders_email_status_valid"
    add_check_constraint :vendor_orders, "email_status IN ('not_sent', 'pending', 'sent', 'failed', 'no_email')",
                         name: "vendor_orders_email_status_valid"
    change_column_default :vendor_orders, :email_status, from: "pending", to: "not_sent"
  end

  def down
    change_column_default :vendor_orders, :email_status, from: "not_sent", to: "pending"
    execute "UPDATE vendor_orders SET email_status = 'pending' WHERE email_status = 'not_sent'" rescue nil
    remove_check_constraint :vendor_orders, name: "vendor_orders_email_status_valid"
    add_check_constraint :vendor_orders, "email_status IN ('pending', 'sent', 'failed', 'no_email')", name: "vendor_orders_email_status_valid"
  end
end
