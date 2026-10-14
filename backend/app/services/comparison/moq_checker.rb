module Comparison
  # MOQ alerts of an upload. Order Qty counts sets/packs, so it is compared with the MOQ in sets (`moq_sets`; the
  # same as the piece MOQ for parts sold singly). Imported orders: below-MOQ orders are combined with the next orders
  # of the same PO + Part + Type until they reach the MOQ (Orders::Combiner); each order or combined order still below
  # the MOQ is alerted (its first row, with the combined Qty). Manual orders (not deleted) are checked on their own.
  # `new_alert` records whether it was not already alerted in the previous upload. Returns the number of alerts.
  class MoqChecker
    def self.call(current_batch_id:, previous_batch_id: nil)
      binds = { current: Integer(current_batch_id), previous: previous_batch_id && Integer(previous_batch_id) }
      imported = imported_alerts(binds)
      manual_sql = ActiveRecord::Base.sanitize_sql_array([ <<~SQL, binds ])
        INSERT INTO moq_alerts (
          upload_batch_id, manual_order_id, product_id, group_key, po_number, part_number, order_type,
          ship_date, qty, moq, new_alert, created_at
        )
        SELECT :current, m.id, p.id, m.group_key, m.po_number, m.part_number, m.order_type,
               m.ship_date, m.qty, COALESCE(p.moq_sets, p.moq),
               NOT EXISTS (SELECT 1 FROM moq_alerts a WHERE a.upload_batch_id = :previous AND a.manual_order_id = m.id),
               CURRENT_TIMESTAMP
        FROM manual_orders m
        JOIN products p ON p.part_number = m.part_number
        WHERE m.deleted_at IS NULL AND m.qty IS NOT NULL AND COALESCE(p.moq_sets, p.moq) IS NOT NULL AND m.qty < COALESCE(p.moq_sets, p.moq)
      SQL
      MoqAlert.insert_all(imported) if imported.any?
      imported.size + ActiveRecord::Base.connection.execute(manual_sql).cmd_tuples
    end

    # One alert per order — or combined order (Orders::Combiner) — of the upload whose Qty is still below the MOQ,
    # on its first (anchor) row with the combined Qty. new_alert: the previous upload had no alert for the same
    # PO + Part + Type.
    def self.imported_alerts(binds)
      result = Orders::Combiner.call(binds[:current])
      return [] if result.open.empty?

      groups = result.open.map { |id| result.groups.fetch(id) }
      previous = binds[:previous] ? MoqAlert.where(upload_batch_id: binds[:previous]).where.not(order_row_id: nil).distinct.pluck(:group_key).to_set : Set.new
      products = Product.where(part_number: groups.map { |g| g.members.first.part_number }.uniq).pluck(:part_number, :id).to_h
      now = Time.current
      groups.map do |g|
        anchor = g.members.first
        { upload_batch_id: binds[:current], order_row_id: anchor.id, product_id: products.fetch(anchor.part_number),
          group_key: anchor.group_key, po_number: anchor.po_number, part_number: anchor.part_number,
          order_type: anchor.order_type, ship_date: anchor.ship_date, qty: g.total, moq: g.moq,
          new_alert: !previous.include?(anchor.group_key), created_at: now }
      end
    end
  end
end
