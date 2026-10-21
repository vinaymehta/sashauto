module Products
  # Checks the Commodity Type of the upload's Part Numbers against existing products (products come from vendor
  # imports and manual entry; an order upload never creates one). An existing product's Commodity Type is never
  # overwritten: a blank one is filled in, a different one becomes an open ProductConflict.
  # The customer price (the file's Unit Price, per 100 pcs) of each existing product is updated from a DTP upload
  # (the most common value of its rows); a change is kept in the price history. A product has one customer price, DTP's:
  # GMBH files are priced differently (per piece, another currency), so they never change it.
  class SyncFromUpload
    def self.call(batch, rows)
      new(batch, rows).call
    end

    def initialize(batch, rows)
      @batch = batch
      groups = rows.group_by { |row| row[:part_number] }
      @incoming = groups.transform_values { |group| group.filter_map { |row| row[:commodity_type] }.uniq.sort }
      @prices = groups.transform_values do |group|
        group.filter_map { |row| unit_price(row) }.tally.max_by { |price, count| [ count, price ] }&.first
      end
    end

    # Returns the number of commodity conflicts opened.
    def call
      products = Product.where(part_number: @incoming.keys).to_a
      conflicts = []

      products.each do |product|
        sync_customer_price(product) if @batch.business == "dtp"
        values = @incoming.fetch(product.part_number)
        if product.commodity_type.nil?
          if values.size == 1
            # Conditional update: never clobber a value set concurrently by a user.
            Product.where(id: product.id, commodity_type: nil).update_all(commodity_type: values.first, updated_at: Time.current)
          elsif values.size > 1
            conflicts.concat(values.map { |value| conflict_attrs(product, nil, value) })
          end
        else
          (values - [ product.commodity_type ]).each do |value|
            conflicts << conflict_attrs(product, product.commodity_type, value)
          end
        end
      end

      return 0 if conflicts.empty?
      ProductConflict.insert_all(conflicts, unique_by: :index_product_conflicts_one_open_per_value, returning: [ :id ]).length
    end

    private

    def unit_price(row)
      value = row[:source]&.[]("Unit Price")
      return nil if value.nil? || value.to_s.strip.empty?
      number = BigDecimal(value.to_s.strip.delete(","), exception: false)
      number if number && !number.negative?
    end

    def sync_customer_price(product)
      price = @prices[product.part_number]
      return if price.nil? || product.customer_price == price

      product.price_source = "upload"
      product.price_upload_batch = @batch
      product.update!(customer_price: price)
    end

    def conflict_attrs(product, existing, incoming)
      now = Time.current
      { product_id: product.id, upload_batch_id: @batch.id, existing_commodity_type: existing,
        incoming_commodity_type: incoming, status: "open", created_at: now, updated_at: now }
    end
  end
end
