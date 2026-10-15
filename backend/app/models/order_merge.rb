# An admin's change to a combined order (Orders::Combiner): an order added by hand (kind "added"), or an order taken
# out of the automatic combining (kind "removed"). Orders are matched by order key (VendorOrderPlacement.order_key),
# so the change carries over to later uploads.
class OrderMerge < ApplicationRecord
  KINDS = %w[added removed].freeze

  belongs_to :added_by, class_name: "User"

  validates :kind, inclusion: { in: KINDS }
end
