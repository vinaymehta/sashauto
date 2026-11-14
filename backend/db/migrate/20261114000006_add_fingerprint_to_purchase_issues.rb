# The same row of a file uploaded again must not open the same issue again: each issue keeps a fingerprint of its
# file kind, business, row (part, PO, vendor, vendor PO / invoice, Qty) and reason.
class AddFingerprintToPurchaseIssues < ActiveRecord::Migration[8.1]
  def change
    add_column :purchase_issues, :fingerprint, :string, limit: 64
    add_index :purchase_issues, :fingerprint
  end
end
