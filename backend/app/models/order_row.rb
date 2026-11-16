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

  # Rows kept on the Orders page though no longer in the uploads `batch_ids` (the current order data) of `businesses`:
  # the last version of each order (PO + Part + PO Line + Ship Date) of an earlier upload with a status mark, a vendor
  # PO or an uploaded invoice (its shipments and history), e.g. an order Deere dropped once it was dispatched.
  def self.kept(batch_ids, businesses)
    ids = batch_ids.map { |id| Integer(id) }.presence || [ 0 ]
    names = businesses.map { |b| connection.quote(b) }.join(",")
    from(<<~SQL.squish)
      (SELECT DISTINCT ON (r.group_key, r.po_line_number, r.ship_date) r.id
       FROM order_rows r JOIN upload_batches b ON b.id = r.upload_batch_id AND b.business IN (#{names})
       WHERE r.upload_batch_id NOT IN (#{ids.join(',')})
         AND r.id IN (SELECT d.order_row_id FROM order_deliveries d WHERE d.removed_at IS NULL
                      UNION SELECT p.order_row_id FROM vendor_order_placements p
                      UNION SELECT a.order_row_id FROM invoice_allocations a JOIN invoices i ON i.id = a.invoice_id AND i.removed_at IS NULL
                            WHERE a.order_row_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM order_rows n WHERE n.upload_batch_id IN (#{ids.join(',')})
                         AND n.group_key = r.group_key AND n.po_line_number = r.po_line_number AND n.ship_date = r.ship_date)
       ORDER BY r.group_key, r.po_line_number, r.ship_date, r.upload_batch_id DESC) AS order_rows
    SQL
  end
end
