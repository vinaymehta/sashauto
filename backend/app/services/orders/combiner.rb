module Orders
  # Combines below-MOQ orders of one upload. Every row of the file is its own order. Within the same PO Number +
  # Part Number + Type (group_key), orders are taken by Ship Date: an order whose Qty is below the part's MOQ starts
  # a combined order, and the next orders (any Qty) join it until the combined Qty reaches the MOQ; then the next
  # below-MOQ order starts a new one. Orders without a Qty, and parts without an MOQ, are never combined.
  #
  # The first order of a combined order is its anchor: the Orders page shows the anchor with the combined Qty (the
  # other orders are listed under it), and vendor orders and status are recorded on the anchor.
  class Combiner
    Row = Data.define(:id, :group_key, :part_number, :po_number, :po_line_number, :order_type, :ship_date, :qty)
    # anchor_id => Group; hidden: ids of the non-anchor members (not listed on their own); open: anchor ids of
    # orders (single or combined) whose Qty is still below the MOQ.
    Group = Data.define(:anchor_id, :members, :total, :moq) do
      def combined? = members.size > 1
      def below_moq? = total < moq
    end
    Result = Data.define(:groups, :hidden, :open)

    COLUMNS = %i[id group_key part_number po_number po_line_number order_type ship_date qty].freeze

    def self.call(batch_id)
      return Result.new(groups: {}, hidden: Set.new, open: Set.new) if batch_id.nil?

      # Cached per upload and MOQ state (the rows of an upload never change; an MOQ edit gives a new key).
      moq_version = Product.where.not(moq: nil).or(Product.where.not(moq_sets: nil)).maximum(:updated_at).to_i
      Rails.cache.fetch([ "orders-combined", batch_id, moq_version ]) { new(batch_id).call }
    end

    def initialize(batch_id)
      @batch_id = batch_id
    end

    def call
      rows = OrderRow.where(upload_batch_id: @batch_id).order(:ship_date, :source_row_number).pluck(*COLUMNS).map { |values| Row.new(*values) }
      moqs = Product.where(part_number: rows.map(&:part_number).uniq).pluck(:part_number, Arel.sql("COALESCE(moq_sets, moq)")).to_h
      groups = {}
      rows.group_by(&:group_key).each_value do |list|
        moq = moqs[list.first.part_number]
        next if moq.nil?

        open = nil
        list.each do |row|
          next if row.qty.nil? || row.qty.zero? # no Qty: not an order to combine

          if open
            open[:members] << row
            open[:total] += row.qty
            open = nil if open[:total] >= moq
          elsif row.qty < moq
            open = { members: [ row ], total: row.qty }
            groups[row.id] = open
          end
        end
      end
      built = groups.transform_values { |g| Group.new(anchor_id: g[:members].first.id, members: g[:members], total: g[:total], moq: moqs[g[:members].first.part_number]) }
      Result.new(groups: built,
                 hidden: built.values.flat_map { |g| g.members.drop(1).map(&:id) }.to_set,
                 open: built.values.select(&:below_moq?).map(&:anchor_id).to_set)
    end
  end
end
