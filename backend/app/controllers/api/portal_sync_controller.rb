module Api
  # Admin Settings → Deere portal: the portal sync's current or last run, and "Run sync now", which starts
  # SecurePortalSyncJob right away (download each business's file from the Deere portal and upload it).
  class PortalSyncController < ApplicationController
    before_action -> { require_role(:admin) }

    def show
      render json: { data: PortalSync.status.merge("running" => PortalSync.running?) }
    end

    def create
      return render_error("A sync is already running. Wait for it to finish.", :conflict) if PortalSync.running?

      PortalSync.write(state: "queued", trigger: "manual", by: current_user.name, requested_at: Time.current)
      SecurePortalSyncJob.perform_later("manual", current_user.id)
      audit("portal_sync.requested")
      render json: { data: PortalSync.status.merge("running" => false) }, status: :accepted
    end
  end
end
