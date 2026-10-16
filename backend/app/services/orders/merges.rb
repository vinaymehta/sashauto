module Orders
  # Orders an admin can add by hand to a combined order (Orders::Combiner), also one still below the MOQ: later
  # orders (Ship Date on or after the anchor's) of the same PO + Part + Type in the same upload, with a Qty, that
  # are not part of another combined order and have no PO generated. Nothing can be added once the combined order's
  # PO is generated.
  module Merges
    module_function

    # A combined order the Schedule shows (and an admin can change): more than one order, or one that had orders
    # taken out.
    def shown?(group)
      group.combined? || group.removed_ids.any?
    end

    def candidates(anchor, combined)
      group = combined.groups[anchor.id]
      return [] unless group && shown?(group)
      return [] if VendorOrderPlacement.exists?(order_key: VendorOrderPlacement.order_key(anchor))

      taken = combined.hidden + combined.groups.values.select(&:combined?).map(&:anchor_id)
      rows = OrderRow.where(upload_batch_id: anchor.upload_batch_id, group_key: anchor.group_key)
                     .where("qty > 0").where(ship_date: anchor.ship_date..).where.not(id: [ anchor.id, *taken ])
                     .order(:ship_date, :source_row_number).to_a
      placed = VendorOrderPlacement.where(order_key: rows.map { |row| VendorOrderPlacement.order_key(row) }).pluck(:order_key).to_set
      rows.reject { |row| placed.include?(VendorOrderPlacement.order_key(row)) }
    end
  end
end
