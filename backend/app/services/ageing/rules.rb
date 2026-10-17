module Ageing
  # Age group of an order row = days since its Firm Date (Orders::FirmDates):
  #   (none)  under 30 days, or no Firm Date (Forecast orders never have one)
  #   green   30–59 days
  #   yellow  60–89 days
  #   red     90 days or more
  # Same rule in the browser (components/age.tsx), the age filters and the ageing email.
  module Rules
    BANDS = %w[red yellow green].freeze # most urgent first
    GREEN_DAYS = 30
    YELLOW_DAYS = 60
    RED_DAYS = 90

    module_function

    def days_since(firm_on, today)
      (today - firm_on).to_i
    end

    # The row's band, or nil without a Firm Date or under 30 days since it.
    def band_for(firm_on, today)
      return nil if firm_on.nil?

      days = days_since(firm_on, today)
      if days >= RED_DAYS then "red"
      elsif days >= YELLOW_DAYS then "yellow"
      elsif days >= GREEN_DAYS then "green"
      end
    end

    # Firm Date range of a band on `today`.
    def firm_date_range(band, today)
      case band
      when "green" then (today - YELLOW_DAYS + 1)..(today - GREEN_DAYS)
      when "yellow" then (today - RED_DAYS + 1)..(today - YELLOW_DAYS)
      else ..(today - RED_DAYS)
      end
    end

    # The rows of `scope` in any of `bands` on `today`. Works for any table with PO Number, Part Number, Type,
    # PO Line Number and Ship Date (order rows, snapshot rows, quantity changes): the Firm Date is found by order key.
    def in_bands(scope, bands, today)
      dates = bands.map { |band| OrderFirmDate.where(firm_on: firm_date_range(band, today)) }.reduce(:or)
      scope.where.not(order_type: "Forecast")
           .where("#{Orders::FirmDates.key_sql(scope.quoted_table_name)} IN (#{dates.select(:order_key).to_sql})")
    end
  end
end
