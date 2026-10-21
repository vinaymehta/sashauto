module Orders
  # The Ship To of an order row, compared with its business's default address (AppConfig.default_ship_to: DTP normally
  # "XPAC, 824 E 8TH ST, MILAN, IL 612643110", GMBH "John Deere GmbH & Co. KG, John-Deere-Strasse 2, Bruchsal, 08 76646").
  # Rows going anywhere else are flagged and emailed after each upload.
  module ShipTo
    module_function

    # "XPAC, 824 E 8TH ST, MILAN, IL 612643110" from the row's Ship to Name / Address / City / Region / PostalCode.
    def address(source)
      source ||= {}
      part = ->(key) { source[key].to_s.squish.presence }
      city = [ part.("Ship to City"), [ part.("Ship to Region"), part.("Ship to PostalCode") ].compact.join(" ").presence ].compact.join(", ")
      [ part.("Ship to Name"), part.("Ship To Address"), city.presence ].compact.join(", ").presence
    end

    # Compared without case, spaces and punctuation, so "824 E. 8th St" matches "824 E 8TH ST".
    def key(text)
      text.to_s.upcase.gsub(/[^A-Z0-9]/, "")
    end

    def default_key(business = "dtp")
      key(AppConfig.default_ship_to(business))
    end

    # True when the row has a Ship To and it is not the default address.
    def other?(source, default = default_key)
      value = address(source)
      !value.nil? && key(value) != default
    end
  end
end
