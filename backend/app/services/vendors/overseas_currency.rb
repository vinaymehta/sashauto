module Vendors
  # Overseas vendors (GST treatment "overseas") are not paid in rupees, but the vendor files do not always say so: the
  # vendor details file has no currency column (a vendor starts as INR) and some price files give bare amounts. After
  # every vendor import, each overseas vendor still on INR gets its currency: the one its parts are priced in in the file
  # (£ for a UK vendor), else from its address (China / Taiwan / Hong Kong: USD, UK: GBP, a euro country: EUR), else
  # USD; then its parts still marked INR take that currency. Vendors already set to another currency are left alone.
  module OverseasCurrency
    module_function

    COUNTRIES = {
      "GBP" => /\b(u\.?\s?k\.?|united kingdom|england|scotland|wales|great britain)\b/i,
      "EUR" => /\b(spain|netherlands|holland|germany|france|italy|belgium|austria|ireland|portugal|finland|greece)\b/i,
      "USD" => /\b(china|p\.?r\.?c\.?|taiwan|hong kong|usa|united states)\b/i
    }.freeze

    # Returns the number of vendors whose currency was set.
    def apply!
      Vendor.where(gst_treatment: "overseas", currency: [ nil, "", "INR" ]).find_each.count do |vendor|
        currency = currency_for(vendor)
        Vendor.transaction do
          vendor.update!(currency: currency)
          vendor.vendor_products.where(price_currency: "INR").update_all(price_currency: currency, updated_at: Time.current)
        end
        Rails.logger.info("[vendors] #{vendor.name}: overseas, currency set to #{currency}")
        true
      end
    end

    def currency_for(vendor)
      priced = vendor.vendor_products.where.not(price_currency: [ nil, "INR" ]).group(:price_currency).count
      return priced.max_by { |_, count| count }.first if priced.any?

      COUNTRIES.find { |_, pattern| vendor.address.to_s.match?(pattern) }&.first || "USD"
    end
  end
end
