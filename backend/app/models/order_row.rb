# One Excel row of one upload, exactly as imported (append-only; see CreateOrderRows).
class OrderRow < ApplicationRecord
  belongs_to :upload_batch

  scope :current_rows, -> { where(current: true) }

  def readonly?
    persisted?
  end

  # PO Number + Part Number + Type identify a group; its latest-ship-date row is current.
  def self.group_key(po_number, part_number, order_type)
    Digest::SHA256.hexdigest([ po_number, part_number, order_type ].join(OrderRows::Normalizer::KEY_SEPARATOR))
  end
end
