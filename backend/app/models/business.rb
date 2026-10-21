# The two Deere suppliers SASH works for, whose order data is kept apart (uploads, orders, POs, dashboard). "all" is
# the combined view (read-only: an upload or a new order always belongs to one business).
module Business
  KEYS = %w[dtp gmbh].freeze
  VIEWS = (KEYS + [ "all" ]).freeze
  LABELS = { "dtp" => "DTP", "gmbh" => "GMBH", "all" => "All" }.freeze

  module_function

  # The businesses of a view: ["dtp"], ["gmbh"] or both for "all" (anything else counts as "all").
  def of(view)
    KEYS.include?(view.to_s) ? [ view.to_s ] : KEYS
  end

  def label(business)
    LABELS.fetch(business.to_s, business.to_s.upcase)
  end

  def currency(business)
    AppConfig.business_currency(business)
  end
end
