module Products
  # Checks the Commodity Type of the upload's Part Numbers against existing products (products come from vendor
  # imports and manual entry; an order upload never creates one). An existing product's Commodity Type is never
  # overwritten: a blank one is filled in, a different one becomes an open ProductConflict.
  class SyncFromUpload
    def self.call(batch, rows)
      new(batch, rows).call
    end

    def initialize(batch, rows)
      @batch = batch
      @incoming = rows.group_by { |row| row[:part_number] }
                      .transform_values { |group| group.filter_map { |row| row[:commodity_type] }.uniq.sort }
    end

    # Returns the number of commodity conflicts opened.
    def call
      products = Product.where(part_number: @incoming.keys).to_a
      conflicts = []

      products.each do |product|
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

    def conflict_attrs(product, existing, incoming)
      now = Time.current
      { product_id: product.id, upload_batch_id: @batch.id, existing_commodity_type: existing,
        incoming_commodity_type: incoming, status: "open", created_at: now, updated_at: now }
    end
  end
end
