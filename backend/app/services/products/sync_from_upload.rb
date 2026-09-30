module Products
  # Registers every Part Number in an upload as a product. An existing product's Commodity Type is
  # never overwritten: a blank one is filled in, a different one becomes an open ProductConflict.
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
      create_missing_products
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

    def create_missing_products
      now = Time.current
      new_parts = @incoming.keys - Product.where(part_number: @incoming.keys).pluck(:part_number)
      return if new_parts.empty?

      records = new_parts.map do |part_number|
        values = @incoming[part_number]
        { part_number: part_number, commodity_type: (values.first if values.size == 1), source: "upload",
          first_seen_upload_batch_id: @batch.id, created_at: now, updated_at: now }
      end
      # ON CONFLICT DO NOTHING covers a product created manually at the same moment.
      Product.insert_all(records, unique_by: :part_number)
    end

    def conflict_attrs(product, existing, incoming)
      now = Time.current
      { product_id: product.id, upload_batch_id: @batch.id, existing_commodity_type: existing,
        incoming_commodity_type: incoming, status: "open", created_at: now, updated_at: now }
    end
  end
end
