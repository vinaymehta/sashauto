# An admin can also take an automatically combined order out of its combined order (kind "removed"); "added" is an
# order added by hand.
class AddKindToOrderMerges < ActiveRecord::Migration[8.1]
  def change
    add_column :order_merges, :kind, :string, null: false, default: "added"
    add_check_constraint :order_merges, "kind IN ('added', 'removed')", name: "order_merges_kind_valid"
  end
end
