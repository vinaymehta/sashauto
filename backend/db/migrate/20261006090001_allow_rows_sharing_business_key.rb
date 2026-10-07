# Only Excel rows identical in every column are merged on upload. Rows that share the business key but differ
# (e.g. one with Qty, one with only Previous Qty) are each stored, so the business key is no longer unique per
# upload in order_snapshot_rows. Existing rows are not touched (DDL only).
class AllowRowsSharingBusinessKey < ActiveRecord::Migration[8.1]
  def up
    remove_index :order_snapshot_rows, name: "index_order_snapshot_rows_on_batch_and_key"
    add_index :order_snapshot_rows, [ :upload_batch_id, :business_key_hash ], name: "index_order_snapshot_rows_on_batch_and_key"
  end

  def down
    remove_index :order_snapshot_rows, name: "index_order_snapshot_rows_on_batch_and_key"
    add_index :order_snapshot_rows, [ :upload_batch_id, :business_key_hash ], unique: true, name: "index_order_snapshot_rows_on_batch_and_key"
  end
end
