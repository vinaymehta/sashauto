# The invoices of a Dispatched mark one by one, with the order row each was sent for (its order key): a combined order's
# mark (one status for its rows) lists each invoice on its own row on the Orders page. Filled by the dispatched orders
# list import (Orders::DispatchImport); empty for marks set by hand (their invoice shows on every row of the order).
class AddInvoiceLinesToOrderDeliveries < ActiveRecord::Migration[8.1]
  def change
    add_column :order_deliveries, :invoice_lines, :jsonb, null: false, default: []
  end
end
