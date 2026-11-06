module Products
  # The Order summary of one business (Products → Order summary), like SASH's "Order Summary" Excel: one row per part
  # (S No, Part Number, Description, MOQ) and, for every day with an upload (newest first), the part's Firm, Addition
  # and Forecast quantity in that day's order file.
  #
  # - A day's file: the last completed upload of the business that day (IST, by completed_at).
  # - Firm: the part's total Qty (effective_qty, as the comparisons count it) of its Firm and Order rows; Forecast: of
  #   its Forecast rows. (Firm + Order is what SASH's file shows as Firm.)
  # - Addition: Firm of the day less Firm of the previous (older) day with an upload, also when that day is not shown
  #   (from / to); 0 on the oldest day.
  # Parts: every part in the shown days' files, by Part Number; S No is the part's place in that list.
  #
  # The totals of each upload come from one grouped query over order_rows and are cached per upload (its rows never
  # change), so a new upload only adds its own totals. Product details (Description, MOQ) are read fresh.
  class OrderSummary
    FIRM_TYPES = %w[Firm Order].freeze
    # Part of the cache key: raise it when the cached totals change shape or meaning.
    CACHE_VERSION = 1
    NONE = [ 0.to_d, 0.to_d ].freeze

    # A day with an upload: its date (IST) and the day's last upload.
    Day = Data.define(:date, :upload)
    # One part: values has [firm, addition, forecast] per shown day, newest first.
    Row = Data.define(:serial, :part_number, :description, :moq, :values)

    def initialize(business, from: nil, to: nil)
      @business = business
      @from = from
      @to = to
    end

    # Every day with a completed upload of the business, newest first.
    def all_days
      @all_days ||= begin
        zone = Time.find_zone!(AppConfig.ageing_time_zone)
        UploadBatch.completed.where(business: @business).order(completed_at: :desc, version_number: :desc)
                   .select(:id, :version_number, :original_filename, :completed_at, :file_sha256)
                   .map { |upload| Day.new(date: upload.completed_at.in_time_zone(zone).to_date, upload: upload) }
                   .uniq(&:date)
      end
    end

    # The days shown: those within from..to (each optional), newest first.
    def days
      @days ||= all_days.select { |day| (@from.nil? || day.date >= @from) && (@to.nil? || day.date <= @to) }
    end

    # [S No, Part Number] of the parts, only those whose Part Number or Description contains `query` when given.
    def entries(query = nil)
      list = part_numbers.each_with_index.map { |part, i| [ i + 1, part ] }
      term = query.to_s.strip.downcase.first(100)
      return list if term.empty?

      list.select { |_, part| part.downcase.include?(term) || products.dig(part, 0).to_s.downcase.include?(term) }
    end

    # The rows of the given entries (#entries).
    def rows(entries)
      entries.map do |serial, part|
        description, moq = products[part]
        values = days.each_with_index.map do |day, i|
          firm, forecast = totals.fetch(day.upload.id).fetch(part, NONE)
          older = days[i + 1] || previous_day
          [ firm, older ? firm - totals.fetch(older.upload.id).fetch(part, NONE).first : 0.to_d, forecast ]
        end
        Row.new(serial: serial, part_number: part, description: description, moq: moq, values: values)
      end
    end

    private

    # The day before the oldest shown day (for its Addition), nil when that is the oldest of all.
    def previous_day
      return @previous_day if defined?(@previous_day)

      @previous_day = days.any? ? all_days[all_days.index(days.last) + 1] : nil
    end

    def part_numbers
      @part_numbers ||= days.flat_map { |day| totals.fetch(day.upload.id).keys }.uniq.sort
    end

    # Part Number => [Description, MOQ (sets when set, otherwise the MOQ)].
    def products
      @products ||= Product.where(part_number: part_numbers)
                           .pluck(:part_number, :description, Arel.sql("COALESCE(moq_sets, moq)"))
                           .to_h { |part, description, moq| [ part, [ description, moq ] ] }
    end

    # upload id => { Part Number => [firm, forecast] } of the shown days and the day before them.
    def totals
      @totals ||= begin
        keys = (days + [ previous_day ]).compact.to_h { |day| [ day.upload.id, cache_key(day.upload) ] }
        cached = Rails.cache.read_multi(*keys.values)
        found = keys.filter_map { |id, key| [ id, cached[key] ] if cached.key?(key) }.to_h
        missing = keys.keys - found.keys
        if missing.any?
          loaded = load(missing)
          Rails.cache.write_multi(loaded.transform_keys { |id| keys.fetch(id) }, expires_in: 30.days)
          found.merge!(loaded)
        end
        found
      end
    end

    # The upload's id and file, and when it completed: a database loaded again gives other keys for its uploads.
    def cache_key(upload)
      [ "products-order-summary", CACHE_VERSION, upload.id, upload.file_sha256, upload.completed_at.to_f ]
    end

    # One grouped query over the uploads' rows.
    def load(ids)
      firm = OrderRow.sanitize_sql_array([ "COALESCE(SUM(COALESCE(effective_qty, 0)) FILTER (WHERE order_type IN (?)), 0)", FIRM_TYPES ])
      forecast = "COALESCE(SUM(COALESCE(effective_qty, 0)) FILTER (WHERE order_type = 'Forecast'), 0)"
      result = ids.index_with { {} }
      OrderRow.where(upload_batch_id: ids).group(:upload_batch_id, :part_number)
              .pluck(:upload_batch_id, :part_number, Arel.sql(firm), Arel.sql(forecast))
              .each { |id, part, firm_qty, forecast_qty| result[id][part] = [ firm_qty.to_d, forecast_qty.to_d ] }
      result
    end
  end
end
