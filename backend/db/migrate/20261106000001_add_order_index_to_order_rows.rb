# The rows of one order (PO + Part + Type, PO Line Number, Ship Date) across all uploads: the Orders page looks them up
# for the Firm Date column (first upload with the order) and for the kept rows (orders no longer in the latest upload).
# The other order_rows indexes start with the upload, so these lookups read every upload's rows.
class AddOrderIndexToOrderRows < ActiveRecord::Migration[8.1]
  def change
    add_index :order_rows, %i[group_key po_line_number ship_date upload_batch_id], name: "index_order_rows_on_order_and_batch"
  end
end
