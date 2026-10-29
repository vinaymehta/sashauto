module Comparison
  # MOQ alerts of an upload, per part as SASH checks them: the Firm Qty of all the part's Firm / Order rows in the
  # upload, less the Qty already on vendor POs (Generate PO) = the balance still to order; a part whose balance is above
  # zero but below its MOQ (in sets, as order Qty counts sets) is alerted ("Need MOQ"), with Deere's received Qty
  # (Cumulative Receipt Qty of its PO lines). Manual orders (not deleted) are checked on their own. `new_alert` records
  # whether it was not already alerted in the previous upload. Returns the number of alerts.
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

    # One alert per part of the upload that needs MOQ (Orders::MoqBalance: Firm Qty - PO issued above zero and below
    # its MOQ), on the part's first Firm / Order row. new_alert: the previous upload had no alert for the part.
    def self.imported_alerts(binds)
      parts = Orders::MoqBalance.parts(binds[:current]).values.select(&:need_moq?)
      return [] if parts.empty?

      previous = binds[:previous] ? MoqAlert.where(upload_batch_id: binds[:previous]).where.not(order_row_id: nil).distinct.pluck(:group_key).to_set : Set.new
      now = Time.current
      parts.map do |part|
        first = part.rows.first
        key = part_key(part.part_number)
        { upload_batch_id: binds[:current], order_row_id: first.id, product_id: part.product.id, group_key: key,
          po_number: part.rows.map(&:po_number).uniq.join(", ").first(255), part_number: part.part_number, order_type: first.order_type,
          ship_date: first.ship_date, qty: part.balance, moq: part.moq, firm_qty: part.firm, po_issued_qty: part.issued,
          received_qty: received(part.rows), description: part.product.description&.first(255), sash_part: part.product.sash_part,
          new_alert: !previous.include?(key), created_at: now }
      end
    end

    # Deere's received Qty of the part: the Cumulative Receipt Qty of each of its PO lines, added up (nil when none).
    def self.received(list)
      lines = list.uniq { |r| [ r.po_number, r.po_line_number ] }
      values = lines.filter_map { |r| OrderRows::Normalizer.quantity(r.source_data&.dig("Cumulative Receipt Qty")) rescue nil }
      values.any? ? values.sum : nil
    end

    # The alert's key for a part (alerts were per PO + Part + Type before; a part's key never matches one of those).
    def self.part_key(part) = Digest::SHA256.hexdigest("moq-part#{OrderRows::Normalizer::KEY_SEPARATOR}#{part}")
  end
end
