module Ageing
  # Age group of an order row = days from today until its ship date:
  #   (none)  more than 45 days away
  #   green   30–45 days away
  #   yellow  15–29 days away
  #   red     under 15 days away, or the ship date has already passed
  # Same rule in the browser (components/age.tsx), the Orders age filter and the ageing email.
  module Rules
    BANDS = %w[red yellow green].freeze # most urgent first
    GREEN_DAYS = 30
    GREEN_MAX_DAYS = 45
    YELLOW_DAYS = 15

    module_function

    def days_until(ship_date, today)
      (ship_date - today).to_i
    end

    # The row's band, or nil when the ship date is more than 45 days away.
    def band_for(ship_date, today)
      days = days_until(ship_date, today)
      if days > GREEN_MAX_DAYS then nil
      elsif days >= GREEN_DAYS then "green"
      elsif days >= YELLOW_DAYS then "yellow"
      else "red"
      end
    end

    # ship_date range of a band on `today`.
    def ship_date_range(band, today)
      case band
      when "green" then (today + GREEN_DAYS)..(today + GREEN_MAX_DAYS)
      when "yellow" then (today + YELLOW_DAYS)..(today + GREEN_DAYS - 1)
      else ..(today + YELLOW_DAYS - 1)
      end
    end
  end
end
