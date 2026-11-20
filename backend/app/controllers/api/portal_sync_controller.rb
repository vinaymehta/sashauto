module Api
  # The Deere portal sync (SecurePortalSyncJob) for the John Deere sync popup and Admin Settings: its current or last
  # run with the SMS OTP it is waiting for (`otp`), "Sync now", and entering that OTP. For admins, the users ticked for
  # the Deere sync alerts (Users → Permissions) and users with Admin Settings.
  class PortalSyncController < ApplicationController
    before_action :require_sync_access

    def show
      render json: { data: status_json }
    end

    def create
      return render_error("A sync is already running. Wait for it to finish.", :conflict) if PortalSync.running?

      PortalSync.write(state: "queued", trigger: "manual", by: current_user.name, requested_at: Time.current)
      SecurePortalSyncJob.perform_later("manual", current_user.id)
      audit("portal_sync.requested")
      render json: { data: status_json }, status: :accepted
    end

    # POST /api/portal_sync/otp { code }: the SMS code the sync is waiting for at Deere's OTP screen.
    def otp
      code = params[:code].to_s.gsub(/\s+/, "")
      return render_error("Enter the code from the SMS.", :unprocessable_content) if code.empty?
      return render_error("The code is too long.", :unprocessable_content) if code.length > 20
      unless OtpHandoff.request(SecurePortal::OTP_KEY)&.dig("status") == "waiting" && OtpHandoff.submit(SecurePortal::OTP_KEY, code)
        return render_error("The sync is not waiting for a code any more.", :unprocessable_content)
      end

      audit("portal_sync.otp_entered")
      render json: { data: status_json }
    end

    private

    def status_json
      PortalSync.status.merge("running" => PortalSync.running?, "otp" => OtpHandoff.request(SecurePortal::OTP_KEY)&.except("label"))
    end

    def require_sync_access
      level = request.get? ? "view" : "edit"
      return if current_user.deere_sync_alerts? || current_user.can?("settings", level)

      render_error "You do not have permission to do this.", :forbidden
    end
  end
end
