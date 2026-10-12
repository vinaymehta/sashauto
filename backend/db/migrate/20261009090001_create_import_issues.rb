# Problems found while importing a vendor workbook (DTP Details): rows that were skipped, and values that
# could not be read (e.g. MOQ "2000 pcs (200 of 10 pcs)"). Kept with the Excel row so an admin can fix and add
# it, dismiss it, or delete the part it created, from the Import issues tab on Products and Vendors.
class CreateImportIssues < ActiveRecord::Migration[8.1]
  def change
    create_table :import_issues do |t|
      t.string :filename, null: false
      t.integer :excel_row, null: false
      t.string :kind, null: false # skipped | unreadable
      t.string :field             # the column the problem is about, e.g. moq, vendor_name
      t.string :message, null: false
      t.jsonb :row_data, null: false, default: {}
      t.references :product, foreign_key: { on_delete: :nullify }
      t.references :vendor_product, foreign_key: { on_delete: :nullify }
      t.string :status, null: false, default: "open" # open | resolved | dismissed
      t.string :resolution # fixed | deleted | reimported (when resolved)
      t.references :imported_by, foreign_key: { to_table: :users }
      t.references :resolved_by, foreign_key: { to_table: :users }
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :import_issues, [ :status, :created_at ]
    add_check_constraint :import_issues, "kind IN ('skipped', 'unreadable')", name: "import_issues_kind_valid"
    add_check_constraint :import_issues, "status IN ('open', 'resolved', 'dismissed')", name: "import_issues_status_valid"
  end
end
