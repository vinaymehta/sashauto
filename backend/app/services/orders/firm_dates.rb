module Orders
  # The Firm Date of an order: the day it, or the combined order it starts (Orders::Combiner), first reached the
  # part's MOQ. Kept by order key, so later uploads keep it even when the Qty drops again.
  module FirmDates
    module_function

    # Records today for the orders of `result` at or above the MOQ that have no Firm Date yet. Only for the latest
    # upload (or the one being imported): orders of earlier uploads were recorded while those were current.
    def record(batch_id, result)
      latest = UploadBatch.latest_completed&.id
      return if result.firm.empty? || (latest && batch_id < latest)

      keys = result.firm.values.uniq
      missing = keys - OrderFirmDate.where(order_key: keys).pluck(:order_key)
      return if missing.empty?

      today = Time.find_zone!(AppConfig.ageing_time_zone).today
      now = Time.current
      OrderFirmDate.insert_all(missing.map { |key| { order_key: key, firm_on: today, created_at: now, updated_at: now } },
                               unique_by: :order_key)
    end

    # order key => Firm Date
    def for_keys(keys)
      OrderFirmDate.where(order_key: keys).pluck(:order_key, :firm_on).to_h
    end
  end
end
