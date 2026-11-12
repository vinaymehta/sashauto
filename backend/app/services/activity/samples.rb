module Activity
  # One sample of every kind of bell notification, to see how each reads. Development only, and only while the file
  # tmp/sample-notifications.txt exists (create it to show them, delete it to hide them; tmp/ is not committed).
  # Nothing is stored: the items are made up on each request, dated today so "Mark as read" hides them until tomorrow.
  module Samples
    SWITCH = "tmp/sample-notifications.txt".freeze

    module_function

    def enabled?
      Rails.env.development? && Rails.root.join(SWITCH).exist?
    end

    def items
      start = Time.current.beginning_of_day
      [
        [ "changes", "DTP order file: 45 changes", "8 Qty up · 28 down · 3 added · 2 removed · 4 dates moved · 2 MOQ alerts · by Admin User", "/orders" ],
        [ "no_changes", "GMBH order file: no changes", "Same as the previous file · by Admin User", "/orders" ],
        [ "no_changes", "DTP order file: no order changes", "8 MOQ alerts · by Admin User", "/orders" ],
        [ "baseline", "GMBH order file: first upload saved", "The next files will be compared with it · by Admin User", "/orders" ],
        [ "upload_failed", "DTP order file rejected", "SupplierRequirements_DTP_12-11-26.xlsx · Open to see the errors · by Admin User", "/orders" ],
        [ "email_failed", "Quantity change email not sent", "DTP order file · Attempt 3 · retrying automatically", "/orders" ],
        [ "delivered", "35 orders marked as Dispatched from SASH Faridabad", "DTP · by Admin User", "/orders" ],
        [ "delivered", "PO 5500929633 · JXAL110010: Delivered to Deere", "GMBH · by Warehouse Manager", "/orders" ],
        [ "conflicts", "3 parts have a Commodity Type conflict", "Open Products to review them", "/products?conflicts=open" ]
      ].each_with_index.map do |(kind, title, description, href), i|
        Feed::Item.new(id: "sample-#{i}", kind: kind, title: "Sample · #{title}", description: description,
                       at: start + 1.minute * (i + 1), href: href)
      end
    end
  end
end
