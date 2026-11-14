# Purchase Received uploads: the Qty each invoice line group (invoice | part | vendor id) had in the file, so the same
# file uploaded again is recognised as the same even where only part of a line could be recorded.
class AddLineTotalsToVendorPoImports < ActiveRecord::Migration[8.1]
  def change
    add_column :vendor_po_imports, :line_totals, :jsonb, null: false, default: {}
  end
end
