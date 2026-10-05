module ManualOrders
  # Creates or edits one manual order from the 47 Excel columns, validated with the upload rules
  # (ExcelImport::OrderRowParser), and applies the existing detection rules in the same transaction:
  #
  # - Create: no previous state, so only the MOQ check (Qty below the Part Number's MOQ).
  # - Edit: the saved values are compared with the new ones like a row of the previous upload with the
  #   same row of the next one: when PO Number + Part Number + Type and Ship Date are unchanged, a different
  #   known quantity is a quantity change and a different Ship To Address an address change. The MOQ
  #   check runs on every save.
  #
  # A Qty below MOQ or another order with the same PO Number + Part Number + Type never blocks the order,
  # but the Admin decides first: unless `confirmed`, a save with warnings is not stored and only returns them
  # (`saved` false); saving again with `confirmed` stores it.
  class Save
    Result = Data.define(:order, :errors, :warnings, :saved) do
      def valid?
        errors.empty?
      end
    end

    TYPED_COLUMNS = %i[po_number part_number order_type ship_date po_line_number ship_to_location commodity_type
                       qty previous_qty effective_qty quantity_source].freeze
    FIELDS = ExcelImport::WorkbookReader::COLUMNS.merge(ExcelImport::WorkbookReader::DETAIL_COLUMNS)
    ADDRESS = "Ship To Address".freeze
    # Numeric in the export but not validated by the upload rules: stored as a number when the value is one.
    NUMBERS = [ "Cumulative Receipt Qty", "Unit Price" ].freeze
    NUMBER = /\A-?\d+(\.\d+)?\z/

    def self.call(order:, values:, user:, confirmed: false)
      new(order, values, user, confirmed).call
    end

    # The form: every column in file order with its input kind and whether the upload rules require it.
    def self.fields
      required = ExcelImport::OrderRowParser::REQUIRED_VALUES.values.map(&:downcase)
      kinds = ExcelImport::OrderRowParser::DETAIL_TYPES.merge(ship_date: :date, qty: :quantity, previous_qty: :quantity)
      ManualOrder::HEADERS.map do |header|
        field = field_for(header)
        { label: header, required: required.include?(header.downcase),
          kind: field == :order_type ? "type" : NUMBERS.include?(header) ? "number" : (kinds[field] || :text).to_s,
          options: field == :order_type ? OrderRows::Normalizer::ORDER_TYPES : nil }.compact
      end
    end

    def self.field_for(header)
      FIELDS.find { |_, label| label.casecmp?(header) }&.first
    end

    def initialize(order, values, user, confirmed)
      @confirmed = confirmed
      @order = order
      @values = values.to_h.transform_keys(&:to_s).slice(*ManualOrder::HEADERS)
      @user = user
    end

    def call
      row, errors = ExcelImport::OrderRowParser.new(nil).parse_row(raw_row)
      return Result.new(order: @order, errors: field_errors(errors), warnings: [], saved: false) if errors.any?

      previous = @order.new_record? ? nil : @order.attributes.symbolize_keys
      @order.assign_attributes(row.slice(*TYPED_COLUMNS, *ExcelImport::OrderRowParser::DETAIL_TYPES.keys).merge(
        group_key: OrderRow.group_key(row[:po_number], row[:part_number], row[:order_type]),
        source_data: source_data(row), source_columns: ManualOrder::HEADERS, updated_by: @user
      ))
      @order.created_by ||= @user
      warnings = self.warnings
      return Result.new(order: @order, errors: {}, warnings: warnings, saved: false) if warnings.any? && !@confirmed

      ManualOrder.transaction do
        @order.save!
        detect(previous)
      end
      Result.new(order: @order, errors: {}, warnings: warnings, saved: true)
    end

    private

    # The values in the shape the workbook reader yields for one Excel row.
    def raw_row
      values = FIELDS.keys.to_h { |field| [ field, @values[ManualOrder::HEADERS.find { |h| h.casecmp?(FIELDS[field]) }] ] }
      { row_number: nil, values: values, source: @values }
    end

    # Parser errors are keyed by the parser's column label; the form uses the Excel header.
    def field_errors(errors)
      errors.to_h do |error|
        header = ManualOrder::HEADERS.find { |h| h.casecmp?(error[:column].to_s) } || error[:column]
        [ header, error[:message] ]
      end
    end

    # All 47 columns as an import stores them: typed values normalized (dates as ISO text, quantities as
    # numbers), every other cell as entered (blank as nil, numbers in NUMBERS as numbers).
    def source_data(row)
      ManualOrder::HEADERS.to_h do |header|
        field = self.class.field_for(header)
        value = field && row.key?(field) ? row[field] : OrderRows::Normalizer.text(@values[header])
        value = BigDecimal(value) if NUMBERS.include?(header) && NUMBER.match?(value.to_s)
        value = value.iso8601 if value.is_a?(Date)
        value = (value.frac.zero? ? value.to_i : value.to_f) if value.is_a?(BigDecimal)
        [ header, value ]
      end
    end

    def detect(previous)
      if previous && previous[:group_key] == @order.group_key && previous[:ship_date] == @order.ship_date
        detect_quantity_change(previous)
        detect_address_change(previous)
      end
      check_moq(previous)
    end

    def detect_quantity_change(previous)
      old_qty = previous[:effective_qty]
      new_qty = @order.effective_qty
      return if old_qty.nil? || new_qty.nil? || old_qty == new_qty

      QuantityChange.create!(
        manual_order: @order, business_key_hash: Digest::SHA256.hexdigest("#{@order.group_key}|#{@order.ship_date.iso8601}|1"),
        ship_to_location: @order.ship_to_location, order_type: @order.order_type, po_number: @order.po_number,
        po_line_number: @order.po_line_number, part_number: @order.part_number, ship_date: @order.ship_date,
        commodity_type: @order.commodity_type || product&.commodity_type, old_qty: old_qty, new_qty: new_qty,
        difference: new_qty - old_qty, direction: new_qty > old_qty ? "increase" : "decrease"
      )
    end

    # Same comparison as Comparison::AddressComparator: trimmed, internal whitespace collapsed.
    def detect_address_change(previous)
      old_address = OrderRows::Normalizer.text(previous[:source_data][ADDRESS])
      new_address = OrderRows::Normalizer.text(@order.source_data[ADDRESS])
      return if old_address.to_s == new_address.to_s

      AddressChange.create!(
        manual_order: @order, group_key: @order.group_key, po_number: @order.po_number, part_number: @order.part_number,
        order_type: @order.order_type, ship_date: @order.ship_date, old_address: old_address, new_address: new_address
      )
    end

    def check_moq(previous)
      return unless below_moq?(@order.qty)

      was_below = previous && previous[:part_number] == @order.part_number && below_moq?(previous[:qty])
      MoqAlert.create!(
        manual_order: @order, product: product, group_key: @order.group_key, po_number: @order.po_number,
        part_number: @order.part_number, order_type: @order.order_type, ship_date: @order.ship_date,
        qty: @order.qty, moq: product.moq, new_alert: !was_below
      )
    end

    def below_moq?(qty)
      !qty.nil? && !product&.moq.nil? && qty < product.moq
    end

    def product
      return @product if defined?(@product)
      @product = Product.find_by(part_number: @order.part_number)
    end

    def warnings
      warnings = []
      latest = UploadBatch.latest_completed
      if OrderRow.where(upload_batch_id: latest&.id, group_key: @order.group_key).exists? ||
         ManualOrder.active.where(group_key: @order.group_key).where.not(id: @order.id).exists?
        warnings << { code: "duplicate_order",
                      message: "An order with PO Number #{@order.po_number}, Part Number #{@order.part_number} and Type " \
                               "#{@order.order_type} already exists. Both orders are kept." }
      end
      if below_moq?(@order.qty)
        warnings << { code: "below_moq",
                      message: "Qty #{Serializers.qty(@order.qty)} is below the MOQ of #{Serializers.qty(product.moq)} " \
                               "for Part Number #{@order.part_number}." }
      end
      warnings
    end
  end
end
