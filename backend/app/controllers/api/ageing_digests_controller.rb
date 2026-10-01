module Api
  # Send the ageing email on demand (for testing or outside the 09:00 schedule).
  #   mode=manual  : same as the daily run now (only rows newly reaching 30/60/90 days)
  #   mode=preview : test email of the rows currently in each band; nothing is marked as notified
  class AgeingDigestsController < ApplicationController
    rate_limit to: 20, within: 1.hour, only: :create, store: RATE_LIMIT_STORE, by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many ageing emails in a short time. Try again later.", :too_many_requests }

    def create
      mode = params[:mode] == "preview" ? "preview" : "manual"
      today = Time.find_zone!(AppConfig.ageing_time_zone).today
      result = Ageing::DigestBuilder.call(mode: mode, today: today, user: current_user)
      audit("ageing.requested", mode: mode, status: result.status, counts: result.counts)
      render json: { data: result.to_h.merge(mode: mode, as_of: today, recipients: Notifications::Outbox.recipients) },
             status: result.status == "queued" ? :accepted : :ok
    end
  end
end
