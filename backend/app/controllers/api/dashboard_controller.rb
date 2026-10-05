module Api
  class DashboardController < ApplicationController
    def show
      latest = UploadBatch.includes(:uploaded_by, :previous_upload_batch, :notifications, :ageing_digests, file_attachment: :blob)
                          .latest_completed_first.first
      since = latest&.completed_at
      counts = counts(
        in_progress: UploadBatch.where(status: %w[pending processing]),
        open_conflicts: ProductConflict.open,
        quantity_changes: ManualOrder.detections(QuantityChange, since: since),
        address_changes: ManualOrder.detections(AddressChange, since: since),
        moq_alerts: ManualOrder.detections(MoqAlert, since: since)
      )
      render json: {
        latest_upload: latest && Serializers.upload_batch(latest, detail: true),
        uploads_in_progress: counts[:in_progress],
        open_product_conflicts: counts[:open_conflicts],
        # Detections from manual order creates/edits since the latest upload (shown with its results).
        manual_detections: counts.slice(:quantity_changes, :address_changes, :moq_alerts)
      }
    end

    private

    # COUNT(*) of each scope, in one query (one subquery per scope).
    def counts(**scopes)
      select = Arel::SelectManager.new.project(*scopes.map { |name, scope| scope.select(Arel.star.count).arel.as(name.to_s) })
      ActiveRecord::Base.connection.select_one(select).symbolize_keys.transform_values(&:to_i)
    end
  end
end
