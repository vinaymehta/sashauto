class CreateProducts < ActiveRecord::Migration[8.1]
  def change
    create_table :products do |t|
      t.string :part_number, null: false
      t.string :commodity_type
      t.string :source, null: false
      t.references :created_by, foreign_key: { to_table: :users }
      t.references :first_seen_upload_batch, foreign_key: { to_table: :upload_batches }
      t.timestamps
    end
    add_index :products, :part_number, unique: true
    add_check_constraint :products, "source IN ('upload', 'manual')", name: "products_source_valid"

    # A differing Commodity Type never overwrites a product silently; it is recorded here for a user to resolve.
    create_table :product_conflicts do |t|
      t.references :product, null: false, foreign_key: true
      t.references :upload_batch, foreign_key: true
      t.string :existing_commodity_type
      t.string :incoming_commodity_type, null: false
      t.string :status, null: false, default: "open"
      t.string :resolution
      t.references :resolved_by, foreign_key: { to_table: :users }
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :product_conflicts, [ :product_id, :incoming_commodity_type ], unique: true,
              where: "status = 'open'", name: "index_product_conflicts_one_open_per_value"
    add_index :product_conflicts, :status
    add_check_constraint :product_conflicts, "status IN ('open', 'resolved')", name: "product_conflicts_status_valid"
    add_check_constraint :product_conflicts, "resolution IS NULL OR resolution IN ('kept_existing', 'accepted_incoming')",
                         name: "product_conflicts_resolution_valid"
  end
end
