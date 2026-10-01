class AgeingNotification < ApplicationRecord
  belongs_to :ageing_digest
  belongs_to :order_snapshot_row, optional: true
  belongs_to :order_row, optional: true
end
