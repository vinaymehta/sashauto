# Vendor details from the vendor master file (Vendor Code, contact, GSTIN, Lead Days, Payment Terms, GST rate) and the
# jurisdictional tax officer address (for the Intimation Letter sent with each PO), plus the fields of the vendor form
# (type, contact name, company name, mobile, language, GST treatment, place of supply, PAN, tax preference, currency,
# portal, remarks).
class AddDetailsToVendors < ActiveRecord::Migration[8.1]
  def change
    change_table :vendors, bulk: true do |t|
      t.string :code, limit: 20
      t.string :vendor_type, null: false, default: "business"
      t.string :salutation, limit: 10
      t.string :first_name, limit: 100
      t.string :last_name, limit: 100
      t.string :company_name, limit: 200
      t.string :mobile, limit: 200
      t.string :language, null: false, default: "English", limit: 40
      t.string :gst_treatment
      t.string :place_of_supply, limit: 60
      t.string :pan, limit: 10
      t.string :tax_preference, null: false, default: "taxable"
      t.string :currency, null: false, default: "INR", limit: 3
      t.string :payment_terms, limit: 200
      t.integer :lead_days
      t.decimal :gst_rate, precision: 5, scale: 2
      t.text :tax_officer_address
      t.boolean :portal_enabled, null: false, default: false
      t.text :remarks
    end
    # Contact numbers from the master file can hold several numbers and names.
    change_column :vendors, :phone, :string, limit: 200

    add_index :vendors, "lower(code)", unique: true, name: "index_vendors_on_lower_code"
    add_check_constraint :vendors, "vendor_type IN ('business', 'individual')", name: "vendors_type_valid"
    add_check_constraint :vendors, "tax_preference IN ('taxable', 'tax_exempt')", name: "vendors_tax_preference_valid"
    add_check_constraint :vendors, "lead_days IS NULL OR lead_days >= 0", name: "vendors_lead_days_valid"
    add_check_constraint :vendors, "gst_rate IS NULL OR gst_rate >= 0", name: "vendors_gst_rate_valid"
  end
end
