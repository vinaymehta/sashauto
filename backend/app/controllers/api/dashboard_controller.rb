module Api
  class DashboardController < ApplicationController
    def show
      latest = UploadBatch.includes(:uploaded_by, :previous_upload_batch, :notifications, :ageing_digests, file_attachment: :blob)
                          .latest_completed_first.first
      in_progress = UploadBatch.where(status: %w[pending processing]).count
      render json: {
        latest_upload: latest && Serializers.upload_batch(latest, detail: true),
        uploads_in_progress: in_progress,
        open_product_conflicts: ProductConflict.open.count
      }
    end
  end
end
