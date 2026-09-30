module Api
  class ActivityController < ApplicationController
    def show
      render json: Activity::Feed.call(current_user)
    end

    # Marks everything currently in the feed as read for this user.
    def read
      current_user.update_column(:notifications_seen_at, Time.current)
      head :no_content
    end
  end
end
