# The Firm Date of an order (by order key): from the uploaded file's "Firm Date" column, otherwise the day it, or
# the combined order it starts, first reached the part's MOQ (Orders::FirmDates).
class OrderFirmDate < ApplicationRecord
end
