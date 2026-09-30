module Api
  class ProductConflictsController < ApplicationController
    def resolve
      conflict = ProductConflict.find(params[:id])
      resolution = params.require(:resolution).to_s
      return render_error("Unknown resolution.", :unprocessable_content) unless ProductConflict::RESOLUTIONS.include?(resolution)

      ProductConflict.transaction do
        conflict.lock!
        return render_error("This conflict was already resolved.", :conflict) unless conflict.open?

        product = conflict.product
        product.update!(commodity_type: conflict.incoming_commodity_type) if resolution == "accepted_incoming"
        conflict.update!(status: "resolved", resolution: resolution, resolved_by: current_user, resolved_at: Time.current)
        audit("product_conflict.resolved", subject: conflict, resolution: resolution, part_number: product.part_number,
              commodity_type_after: product.commodity_type)
      end

      product = conflict.product.reload
      render json: { data: Serializers.product(product, open_conflicts: product.product_conflicts.open.includes(:upload_batch)) }
    end
  end
end
