# One Excel row of one upload, exactly as imported (append-only; see CreateOrderRows).
class OrderRow < ApplicationRecord
  belongs_to :upload_batch

  scope :current_rows, -> { where(current: true) }

  def readonly?
    persisted?
  end

  # PO Number + Part Number + Type identify a group; its latest-ship-date row is current.
  # Firm / Order orders (with these columns) that are no longer in the uploads `batch_ids` (the current order data),
  # from earlier completed uploads: each delivery's (PO + Part + PO Line + Ship Date; Deere sometimes turns an Order
  # into a Firm) last version with a Qty, else its last version. Deere drops a delivery from its file once received.
  def self.dropped(batch_ids, **conditions)
    older = joins(:upload_batch).where(upload_batches: { status: "completed" }).where(conditions)
            .where.not(upload_batch_id: batch_ids).where.not(order_type: "Forecast")
            .where("NOT EXISTS (SELECT 1 FROM order_rows n WHERE n.upload_batch_id IN (?) AND n.group_key = order_rows.group_key " \
                   "AND n.po_line_number = order_rows.po_line_number AND n.ship_date = order_rows.ship_date)", batch_ids.presence || [ 0 ])
            .select("DISTINCT ON (order_rows.po_number, order_rows.part_number, order_rows.po_line_number, order_rows.ship_date) order_rows.id")
            .order(Arel.sql("order_rows.po_number, order_rows.part_number, order_rows.po_line_number, order_rows.ship_date, " \
                            "(order_rows.qty > 0) DESC NULLS LAST, order_rows.upload_batch_id DESC"))
    where(id: older)
  end

  def self.group_key(po_number, part_number, order_type)
    Digest::SHA256.hexdigest([ po_number, part_number, order_type ].join(OrderRows::Normalizer::KEY_SEPARATOR))
  end
end
