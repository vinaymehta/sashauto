# Rows of the vendor details / tax officer files that could not be saved (no matching vendor, or a possible duplicate)
# become import issues too (kind "vendor_details"), resolved by linking them to a vendor or adding a new one.
class AddVendorDetailsImportIssues < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :import_issues, name: "import_issues_kind_valid"
    add_check_constraint :import_issues, "kind IN ('skipped', 'unreadable', 'vendor_details')", name: "import_issues_kind_valid"
  end

  def down
    execute "DELETE FROM import_issues WHERE kind = 'vendor_details'"
    remove_check_constraint :import_issues, name: "import_issues_kind_valid"
    add_check_constraint :import_issues, "kind IN ('skipped', 'unreadable')", name: "import_issues_kind_valid"
  end
end
