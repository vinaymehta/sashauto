module Api
  # The Settings page (admins): business settings saved in the app instead of .env (AppSetting). Each value comes with
  # where it is from: "app" (saved here), "env" (.env) or "none". Secrets are never sent back, only whether they are set.
  class SettingsController < ApplicationController
    def index
      render json: { data: AppSetting::DEFINITIONS.map { |d| serialize(d) } }
    end

    # PATCH { settings: { KEY => value } }. A blank value clears the saved one (.env applies again); a secret left out
    # keeps its value.
    def update
      changes = params.require(:settings).permit(*AppSetting::KEYS).to_h
      AppSetting.transaction do
        changes.each do |key, value|
          value = value.to_s.strip
          record = AppSetting.find_or_initialize_by(key: key)
          next if record.value.to_s == value

          record.update!(value: value.presence, updated_by: current_user)
        end
      end
      Rails.cache.delete(AppSetting::CACHE_KEY)
      audit("settings.updated", keys: changes.keys)
      render json: { data: AppSetting::DEFINITIONS.map { |d| serialize(d) } }
    end

    # POST { layout: "sash" | "standard" | "export", settings: { KEY => value } }: a sample purchase order (PDF) in that
    # layout with the given wording, not saved yet (the Purchase Order editor's preview).
    def po_preview
      layout = { "sash" => VendorOrders::IndiaPdfBuilder, "standard" => VendorOrders::PdfBuilder,
                 "export" => VendorOrders::ExportPdfBuilder }.fetch(params[:layout].to_s, VendorOrders::IndiaPdfBuilder)
      values = params.fetch(:settings, {}).permit(*AppSetting::KEYS).to_h
      pdf = AppConfig.with_settings(values) { layout.new(sample_po(layout == VendorOrders::ExportPdfBuilder)).render }
      send_data pdf, type: "application/pdf", disposition: "inline", filename: "purchase-order-preview.pdf"
    end

    private

    # The order the preview prints: two parts, as on SASH's sample PO (an overseas vendor in US dollars for "export").
    def sample_po(overseas)
      vendor = Vendor.new(name: overseas ? "SAMPLE SUPPLIER LTD." : "SEEMA & CO.", gst: overseas ? nil : "07AADPG6674K1ZF", gst_rate: overseas ? nil : 18,
                          address: overseas ? "Unit 4, Sample Industrial Park\nShanghai, China" : "43A/2 Gurudwara Road Dilshad Garden,\nDelhi - 95",
                          gst_treatment: overseas ? "overseas" : "registered_regular")
      line = ->(description, part, vendor_part, qty, rate) do
        VendorOrders::PdfBuilder::Line.new(our_article: part, part_number: part, vendor_article: vendor_part, description: description, qty: qty,
                                           uom: "PCS", unit_cost: rate, total: rate * qty, note: nil)
      end
      VendorOrders::PdfBuilder::Po.new(number: "5501072350/SC/03-09-26", date: Date.current, vendor: vendor, required_by: Date.current + 30,
                                       currency: overseas ? "USD" : "INR", prepared_by: current_user.name, draft: false, reference: "5501072350",
                                       lines: [ line.("Switch (A04-2839)", "JXAR30278", "A04-2839", 100, overseas ? 6.6.to_d : 550.to_d),
                                                line.("Switch (A04-0414)", "JXAR30279", "A04-0414", 100, overseas ? 5.4.to_d : 450.to_d) ])
    end

    def serialize(definition)
      saved = AppSetting[definition.key]
      env = ENV[definition.key].presence
      secret = definition.kind == :secret
      { key: definition.key, label: definition.label, group: definition.group, kind: definition.kind, hint: definition.hint,
        options: definition.options, default_value: definition.default, source: saved ? "app" : env ? "env" : "none",
        value: secret ? nil : saved || "", env_value: secret ? nil : env, set: (saved || env).present? }
    end
  end
end
