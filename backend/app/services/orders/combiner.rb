module Orders
  # Combines below-MOQ orders of one upload. Every row of the file is its own order. Within the same PO Number +
  # Part Number + Type (group_key), orders are taken by Ship Date: an order whose Qty is below the part's MOQ starts
  # a combined order, and the next orders (any Qty) join it until the combined Qty reaches the MOQ; then the next
  # below-MOQ order starts a new one. Orders without a Qty, and parts without an MOQ, are never combined.
  # An admin can add more orders to a combined order by hand (OrderMerge "added"): those are left out of the
  # automatic combining and added to it afterwards. An admin can also take an order out (OrderMerge "removed"): it is
  # dropped from its combined order and stays on its own; nothing else changes (no other order joins in its place).
  #
  # The first order of a combined order is its anchor: the Orders page shows the anchor with the combined Qty (the
  # other orders are listed under it), and vendor orders and status are recorded on the anchor.
  class Combiner
    Row = Data.define(:id, :group_key, :part_number, :po_number, :po_line_number, :order_type, :ship_date, :qty)
    # anchor_id => Group; hidden: ids of the non-anchor members (not listed on their own); open: anchor ids of
    # orders (single or combined) whose Qty is still below the MOQ; firm: id => order key of every order (single or
    # combined) at or above the MOQ. manual_ids: members added by hand; removed_ids: orders taken out of it.
    Group = Data.define(:anchor_id, :members, :total, :moq, :manual_ids, :removed_ids) do
      def combined? = members.size > 1
      def below_moq? = total < moq
    end
    Result = Data.define(:groups, :hidden, :open, :firm)

    COLUMNS = %i[id group_key part_number po_number po_line_number order_type ship_date qty].freeze
    # Part of the cache key: raise it when Group or Result change, so results cached in the old shape are not read.
    CACHE_VERSION = 2

    def self.call(batch_id)
      return Result.new(groups: {}, hidden: Set.new, open: Set.new, firm: {}) if batch_id.nil?

      # Cached per upload, MOQ state and merges (the rows of an upload never change; an MOQ edit or a merge gives a
      # new key). Firm Dates are recorded whenever the result changes.
      moq_version = Product.where.not(moq: nil).or(Product.where.not(moq_sets: nil)).maximum(:updated_at).to_i
      merge_version = OrderMerge.pick(Arel.sql("COUNT(*)"), Arel.sql("COALESCE(SUM(id), 0)"))
      Rails.cache.fetch([ "orders-combined", CACHE_VERSION, batch_id, moq_version, *merge_version ]) do
        new(batch_id).call.tap { |result| FirmDates.record(batch_id, result) }
      end
    end

    def initialize(batch_id)
      @batch_id = batch_id
    end

    def call
      rows = OrderRow.where(upload_batch_id: @batch_id).order(:ship_date, :source_row_number).pluck(*COLUMNS).map { |values| Row.new(*values) }
      moqs = Product.where(part_number: rows.map(&:part_number).uniq).pluck(:part_number, Arel.sql("COALESCE(moq_sets, moq)")).to_h
      keys = rows.to_h { |row| [ row.id, VendorOrderPlacement.order_key(row) ] }
      by_key = rows.index_by { |row| keys[row.id] }
      changes = OrderMerge.where(group_key: rows.map(&:group_key).uniq).pluck(:member_key, :anchor_key, :kind)
      # member key => anchor key of orders added by hand, for anchors in this upload; keys of orders taken out.
      merges = changes.select { |_, _, kind| kind == "added" }.to_h { |member, anchor, _| [ member, anchor ] }.select { |_, anchor| by_key[anchor] }
      removed = changes.select { |_, _, kind| kind == "removed" }.to_set(&:first)
      manual, auto = rows.partition { |row| merges.key?(keys[row.id]) }

      groups = {}
      auto.group_by(&:group_key).each_value do |list|
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

      # Orders taken out leave their combined order (never its first order); the rest stays as combined.
      groups.each_value do |g|
        out, g[:members] = g[:members].partition.with_index { |m, i| i.positive? && removed.include?(keys[m.id]) }
        g[:total] -= out.sum(&:qty)
        g[:removed] = out.map(&:id)
      end

      # Orders added by hand join their anchor's combined order (the anchor alone if it is no longer combined).
      joined = groups.values.flat_map { |g| g[:members].drop(1).map(&:id) }.to_set
      manual.each do |row|
        anchor = by_key[merges[keys[row.id]]]
        next if row.qty.nil? || row.qty.zero? || joined.include?(anchor.id) || merges.key?(keys[anchor.id]) || moqs[anchor.part_number].nil?

        group = groups[anchor.id] ||= { members: [ anchor ], total: anchor.qty.to_d }
        group[:members] << row
        group[:total] += row.qty
        (group[:manual] ||= []) << row.id
      end

      built = groups.to_h do |anchor_id, g|
        members = g[:members].sort_by { |m| [ m.ship_date, m.id == anchor_id ? 0 : 1, m.id ] }
        [ anchor_id, Group.new(anchor_id: anchor_id, members: members, total: g[:total], moq: moqs[members.first.part_number],
                               manual_ids: g[:manual] || [], removed_ids: g[:removed] || []) ]
      end
      hidden = built.values.flat_map { |g| g.members.map(&:id) - [ g.anchor_id ] }.to_set
      firm = built.values.reject(&:below_moq?).to_h { |g| [ g.anchor_id, keys[g.anchor_id] ] }
      rows.each do |row|
        next if built.key?(row.id) || hidden.include?(row.id)

        moq = moqs[row.part_number]
        firm[row.id] = keys[row.id] if moq && row.qty && row.qty >= moq
      end
      Result.new(groups: built, hidden: hidden, open: built.values.select(&:below_moq?).map(&:anchor_id).to_set, firm: firm)
    end
  end
end
