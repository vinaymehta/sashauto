module Api
  class ActivityController < ApplicationController
    READ_IDS_KEPT = 200

    def show
      render json: Activity::Feed.call(current_user)
    end

    # POST /api/activity/read: marks everything currently in the feed as read for this user. With `id`: only that
    # notification (opened from the bell); the last READ_IDS_KEPT opened are remembered.
    def read
      if (id = params[:id].to_s.first(100).presence)
        ids = (current_user.read_notification_ids - [ id ] + [ id ]).last(READ_IDS_KEPT)
        current_user.update_column(:read_notification_ids, ids)
      else
        current_user.update_columns(notifications_seen_at: Time.current, read_notification_ids: [])
      end
      head :no_content
    end
  end
end
