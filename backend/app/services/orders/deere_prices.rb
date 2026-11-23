module Orders
  # Deere's price of an order (per 100 pcs, as in its files) under the price model chosen in Admin Settings → Businesses
  # (AppConfig.price_model):
  #   latest      every order at Deere's latest price, whatever its date: the PO + Part's Unit Price in the business's
  #               latest file, else the Part's there (an older order, or one Deere has dropped, at today's price).
  #   order_date  every order at the price it came with: its Unit Price in the first file of its business that listed it
  #               as a Firm / Order row (the day it first came). An order that came before a price change keeps the old
  #               price; one that came after gets the new price.
  # Without one (e.g. a manual order under order_date): the row's own Unit Price. Callers fall back to the product's
  # customer price after that, and price a charge (freight) as is.
  #
  #   prices = Orders::DeerePrices.new
  #   prices.price(business: "dtp", po_number:, part_number:, order_key:, unit: row.source_data["Unit Price"])
  #   prices.price_sql("order_rows")   # the same price in SQL (NULL without one), for sorting and sums
  class DeerePrices
    # A Unit Price cell as a number: digits with an optional decimal part, thousands commas and spaces ignored.
    NUMBER = /\A\d+(\.\d+)?\z/

    attr_reader :model

    def initialize(model = AppConfig.price_model)
      @model = model
    end

    # The order's price (BigDecimal, per 100 pcs) under the model, else its own Unit Price (`unit`, the file's text);
    # nil without either. `order_key`: VendorOrderPlacement.order_key of an imported row (nil for a manual order).
    def price(business:, po_number:, part_number:, order_key:, unit:)
      model_price(business, po_number, part_number, order_key) || self.class.number(unit)
    end

    # The model's price alone (nil when it has none for the order).
    def model_price(business, po_number, part_number, order_key)
      if model == "order_date"
        order_key && came[order_key]
      else
        latest[[ business, po_number, part_number ]] || latest[[ business, part_number ]]
      end
    end

    # #price in SQL for the rows of `table` (with business, manual, group_key, po_line_number, ship_date, po_number,
    # part_number and source_data columns, as OrdersController#dataset), numeric per 100 pcs or NULL.
    def price_sql(table)
      own = number_sql("#{table}.source_data->>'Unit Price'")
      "COALESCE(#{model_price_sql(table)}, #{own})"
    end

    # The Unit Price cell text as a number, nil when it is not one.
    def self.number(text)
      value = text.to_s.delete(",").strip
      value.match?(NUMBER) ? BigDecimal(value) : nil
    end

    private

    def model_price_sql(table)
      return came_sql(table) if model == "order_date"

      batches = UploadBatch.latest_for("all")
      return "NULL::numeric" if batches.empty?

      quote = ->(v) { OrderRow.connection.quote(v) }
      cases = batches.map do |b|
        by = ->(where) do
          "(SELECT #{number_sql("r.source_data->>'Unit Price'")} FROM order_rows r WHERE r.upload_batch_id = #{Integer(b.id)} AND #{where} " \
            "AND #{positive_sql('r')} ORDER BY r.source_row_number LIMIT 1)"
        end
        "WHEN #{quote.(b.business)} THEN COALESCE(#{by.("r.po_number = #{table}.po_number AND r.part_number = #{table}.part_number")}, " \
          "#{by.("r.part_number = #{table}.part_number")})"
      end
      "(CASE #{table}.business #{cases.join(' ')} END)"
    end

    # The order's Unit Price in the first completed upload that listed it as Firm / Order (by the order's PO + Part + Type,
    # PO Line and Ship Date, as VendorOrderPlacement.order_key); NULL for a manual order.
    def came_sql(table)
      "(CASE WHEN #{table}.manual THEN NULL ELSE (SELECT #{number_sql("r.source_data->>'Unit Price'")} FROM order_rows r " \
        "JOIN upload_batches b ON b.id = r.upload_batch_id AND b.status = 'completed' " \
        "WHERE r.group_key = #{table}.group_key AND r.po_line_number = #{table}.po_line_number AND r.ship_date = #{table}.ship_date " \
        "AND r.order_type IN ('Firm', 'Order') AND #{positive_sql('r')} " \
        "ORDER BY b.completed_at, b.id, r.source_row_number LIMIT 1) END)"
    end

    def number_sql(expr)
      clean = "regexp_replace(COALESCE(#{expr}, ''), '[,[:space:]]', '', 'g')"
      "(CASE WHEN #{clean} ~ '^[0-9]+(\\.[0-9]+)?$' THEN #{clean}::numeric END)"
    end

    def positive_sql(alias_name)
      "COALESCE(#{number_sql("#{alias_name}.source_data->>'Unit Price'")}, 0) > 0"
    end

    # [business, PO, Part] and [business, Part] => the first positive Unit Price in each business's latest file.
    def latest
      @latest ||= begin
        batches = UploadBatch.latest_for("all").to_h { |b| [ b.id, b.business ] }
        OrderRow.where(upload_batch_id: batches.keys).order(:upload_batch_id, :source_row_number)
                .pluck(:upload_batch_id, :po_number, :part_number, Arel.sql("source_data->>'Unit Price'"))
                .each_with_object({}) do |(batch, po, part, unit), prices|
          price = self.class.number(unit)
          next unless price&.positive?

          prices[[ batches[batch], po, part ]] ||= price
          prices[[ batches[batch], part ]] ||= price
        end
      end
    end

    # order key => the Unit Price of the order in the first completed upload that listed it as Firm / Order (with a
    # positive price). Uploads never change once completed, so this is cached until the next upload.
    def came
      @came ||= begin
        completed = UploadBatch.where(status: "completed")
        key = [ "orders/deere_prices/came/v1", completed.maximum(:id), completed.count ]
        Rails.cache.fetch(key) do
          sql = <<~SQL
            SELECT DISTINCT ON (r.group_key, r.po_line_number, r.ship_date) r.group_key, r.po_line_number, r.ship_date, r.source_data->>'Unit Price'
            FROM order_rows r JOIN upload_batches b ON b.id = r.upload_batch_id AND b.status = 'completed'
            WHERE r.order_type IN ('Firm', 'Order') AND #{positive_sql('r')}
            ORDER BY r.group_key, r.po_line_number, r.ship_date, b.completed_at, b.id, r.source_row_number
          SQL
          OrderRow.connection.select_rows(sql).to_h do |group, line, ship, unit|
            [ Digest::SHA256.hexdigest([ group, line, ship.to_s ].join(OrderRows::Normalizer::KEY_SEPARATOR)), unit.to_s.delete(",").strip ]
          end
        end.transform_values { |unit| BigDecimal(unit) }
      end
    end
  end
end
