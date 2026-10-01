module Ageing
  # Age of an order row = days since its ship date. Bands: 30-59 green, 60-89 yellow, 90+ red;
  # 0-29 days and future ship dates have no band. An email is sent the first time a row reaches
  # each threshold (30, 60, 90).
  module Rules
    THRESHOLDS = [ 30, 60, 90 ].freeze
    BAND = { 30 => "green", 60 => "yellow", 90 => "red" }.freeze

    module_function

    def days_since(ship_date, today)
      (today - ship_date).to_i
    end

    # Highest threshold reached, or nil.
    def threshold_for(ship_date, today)
      days = days_since(ship_date, today)
      THRESHOLDS.reverse.find { |t| days >= t }
    end

    # ship_date range for the band that starts at `threshold` (upper band is open-ended).
    def ship_date_range(threshold, today)
      upper = THRESHOLDS[THRESHOLDS.index(threshold) + 1]
      upper ? ((today - (upper - 1))..(today - threshold)) : ..(today - threshold)
    end
  end
end
