module Activity
  # Items for the notification bell, derived from records that already exist (finished uploads,
  # their email notifications, order status marks, open product conflicts). Nothing is stored per item; a user's
  # `notifications_seen_at` ("Mark as read") and `read_notification_ids` (opened one by one) decide what is unread.
  class Feed
    LIMIT = 20

    Item = Data.define(:id, :kind, :title, :description, :at, :href)

    def self.call(user)
      new(user).call
    end

    def initialize(user)
      @user = user
    end

    def call
      items = (upload_items + conflict_items + delivery_items).sort_by { |item| -item.at.to_f }.first(LIMIT)
      items = Samples.items + items if Samples.enabled? # development only: one of each kind (Activity::Samples)
      seen = @user.notifications_seen_at
      opened = @user.read_notification_ids.to_set
      unread = ->(item) { (seen.nil? || item.at > seen) && !opened.include?(item.id) }
      { items: items.map { |item| item.to_h.merge(unread: unread.(item)) }, unread_count: items.count(&unread) }
    end

    # Marks loaded to build the delivery items: a dispatch list import marks many orders at once (one item for them).
    DELIVERY_LIMIT = 500

    EMAIL_TITLES = {
      "quantity_changes" => "Quantity change", "address_changes" => "Address change",
      "moq_alerts" => "MOQ alert", "ship_to_alerts" => "Ship To alert", "ageing" => "Ageing"
    }.freeze

    private

    def upload_items
      UploadBatch.where(status: %w[completed failed])
                 .includes(:uploaded_by, :notifications, :ageing_digests)
                 .order(Arel.sql("COALESCE(completed_at, failed_at) DESC"))
                 .limit(LIMIT)
                 .flat_map { |batch| items_for(batch) }
    end

    # One item per upload: its business, what changed (as counted on the Changes tab) and who uploaded it.
    def items_for(batch)
      href = "/uploads/#{batch.id}"
      by = "by #{batch.uploaded_by.name}"
      file = "#{Business.label(batch.business)} order file"

      if batch.status == "failed"
        return [ Item.new(id: "upload-#{batch.id}", kind: "upload_failed", title: "#{file} rejected",
                          description: "#{batch.original_filename} · Open to see the errors · #{by}", at: batch.failed_at, href: href) ]
      end

      item = ->(kind, title, description) { Item.new(id: "upload-#{batch.id}", kind: kind, title: title, description: description, at: batch.completed_at, href: href) }
      items =
        if batch.previous_upload_batch_id.nil?
          [ item.("baseline", "#{file}: first upload saved", "The next files will be compared with it · #{by}") ]
        else
          parts = { "Qty up" => batch.increase_count, "down" => batch.decrease_count, "added" => batch.new_row_count,
                    "removed" => batch.missing_row_count, "date#{'s' unless batch.rescheduled_count.to_i == 1} moved" => batch.rescheduled_count,
                    "address" => batch.address_change_count }.transform_values(&:to_i).select { |_, n| n.positive? }
          changes = parts.values.sum
          alerts = batch.moq_alert_count.to_i
          if changes.zero? && alerts.zero?
            [ item.("no_changes", "#{file}: no changes", "Same as the previous file · #{by}") ]
          else
            summary = parts.map { |label, n| "#{n} #{label}" }
            summary << "#{alerts} MOQ alert#{'s' unless alerts == 1}" if alerts.positive?
            title = changes.positive? ? "#{file}: #{changes} change#{'s' unless changes == 1}" : "#{file}: no order changes"
            [ item.(changes.positive? ? "changes" : "no_changes", title, "#{summary.join(' · ')} · #{by}") ]
          end
        end

      Serializers.upload_emails(batch).select { |email| email[:status] == "failed" }.each do |email|
        items << Item.new(id: "email-#{email[:kind]}-#{email[:id]}", kind: "email_failed",
                          title: "#{EMAIL_TITLES.fetch(email[:kind])} email not sent",
                          description: "#{file} · Attempt #{email[:attempts]} · retrying automatically",
                          at: email[:last_attempt_at] || batch.completed_at, href: href)
      end
      items
    end

    # Status marks (received, dispatched, delivered to SASH US / Deere). The marks one person set for one business in the
    # same minute (e.g. a dispatch list import) are one item; a single mark names its PO and part.
    def delivery_items
      marks = OrderDelivery.active.includes(:marked_by, :manual_order, order_row: :upload_batch).order(created_at: :desc).limit(DELIVERY_LIMIT)
      marks.group_by { |d| [ d.kind, d.marked_by_id, business_of(d), d.created_at.beginning_of_minute ] }.map do |(kind, _, business, _), list|
        d = list.first
        where = business ? "#{Business.label(business)} · " : ""
        if list.size == 1
          Item.new(id: "delivery-#{d.id}", kind: "delivered", title: "PO #{d.po_number} · #{d.part_number}: #{d.label}",
                   description: "#{where}by #{d.marked_by.name}", at: d.created_at, href: "/orders")
        else
          Item.new(id: "deliveries-#{d.id}", kind: "delivered", title: "#{list.size} orders marked as #{OrderDelivery::LABELS.fetch(kind)}",
                   description: "#{where}by #{d.marked_by.name}", at: d.created_at, href: "/orders")
        end
      end
    end

    def business_of(delivery)
      delivery.order_row&.upload_batch&.business || delivery.manual_order&.business
    end

    def conflict_items
      open = ProductConflict.open
      parts = open.distinct.count(:product_id)
      return [] if parts.zero?

      [ Item.new(id: "conflicts", kind: "conflicts", title: "#{parts} part#{parts == 1 ? ' has a' : 's have a'} Commodity Type conflict",
                 description: "Open Products to review #{parts == 1 ? 'it' : 'them'}", at: open.maximum(:created_at), href: "/products?conflicts=open") ]
    end
  end
end
