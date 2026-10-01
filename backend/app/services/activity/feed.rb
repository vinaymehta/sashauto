module Activity
  # Items for the notification bell, derived from records that already exist (finished uploads,
  # their email notifications, open product conflicts). Nothing is stored per item; a user's
  # `notifications_seen_at` decides what counts as unread.
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
      items = (upload_items + conflict_items).sort_by { |item| -item.at.to_f }.first(LIMIT)
      seen = @user.notifications_seen_at
      { items: items.map(&:to_h), unread_count: items.count { |item| seen.nil? || item.at > seen } }
    end

    private

    def upload_items
      UploadBatch.where(status: %w[completed failed])
                 .includes(:uploaded_by, :notification)
                 .order(Arel.sql("COALESCE(completed_at, failed_at) DESC"))
                 .limit(LIMIT)
                 .flat_map { |batch| items_for(batch) }
    end

    def items_for(batch)
      href = "/uploads/#{batch.id}"
      by = batch.uploaded_by.name

      if batch.status == "failed"
        return [ Item.new(id: "upload-#{batch.id}", kind: "upload_failed", title: "Upload rejected",
                          description: "#{batch.original_filename} · #{by}", at: batch.failed_at, href: href) ]
      end

      changes = batch.previous_upload_batch_id ? batch.increase_count + batch.decrease_count + batch.address_change_count.to_i : nil
      title =
        if changes.nil? then "First upload stored"
        elsif changes.positive? then "#{changes} order change#{'s' unless changes == 1} detected"
        else "Upload processed: no quantity changes"
        end
      description = changes.to_i.positive? ? "#{batch.increase_count} up · #{batch.decrease_count} down · #{by}" : "#{batch.original_filename} · #{by}"
      kind = changes.nil? ? "baseline" : (changes.positive? ? "changes" : "no_changes")
      items = [ Item.new(id: "upload-#{batch.id}", kind: kind, title: title, description: description, at: batch.completed_at, href: href) ]

      notification = batch.notification
      if notification&.status == "failed"
        items << Item.new(id: "email-#{notification.id}", kind: "email_failed", title: "Change alert email failed",
                          description: "Attempt #{notification.attempts} · retrying automatically",
                          at: notification.last_attempt_at || batch.completed_at, href: href)
      end
      items
    end

    def conflict_items
      open = ProductConflict.open
      count = open.count
      return [] if count.zero?

      [ Item.new(id: "conflicts", kind: "conflicts", title: "#{count} Commodity Type conflict#{'s' unless count == 1}",
                 description: "Products need review", at: open.maximum(:created_at), href: "/products?conflicts=open") ]
    end
  end
end
