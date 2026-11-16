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

  # POs left out of the Dashboard's figures, per business: GMBH's POs starting with 45.
  DASHBOARD_EXCLUDED_PO_PREFIX = { "gmbh" => "45" }.freeze

  # Whether an order of this business and PO is left out of the Dashboard.
  def dashboard_excluded?(business, po_number)
    prefix = DASHBOARD_EXCLUDED_PO_PREFIX[business.to_s]
    prefix.present? && po_number.to_s.start_with?(prefix)
  end

  # SQL condition true for the orders left out of the Dashboard (`business` and `po` are the columns' SQL).
  def dashboard_excluded_sql(business, po)
    conditions = DASHBOARD_EXCLUDED_PO_PREFIX.map do |key, prefix|
      "(#{business} = #{ActiveRecord::Base.connection.quote(key)} AND #{po} LIKE #{ActiveRecord::Base.connection.quote("#{prefix}%")})"
    end
    conditions.any? ? "(#{conditions.join(' OR ')})" : "FALSE"
  end
end
