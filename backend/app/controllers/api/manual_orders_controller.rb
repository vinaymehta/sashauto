module Api
  # Orders created by hand (Admin only), with the 47 Excel columns. They are listed on the Orders page next
  # to the latest upload's rows; see ManualOrders::Save for validation and detection.
  class ManualOrdersController < ApplicationController
    before_action -> { require_role(:admin) }, only: %i[create update destroy]
    rate_limit to: 120, within: 1.hour, only: %i[create update destroy], store: RATE_LIMIT_STORE,
               by: -> { current_user&.id || request.remote_ip },
               with: -> { render_error "Too many changes in a short time. Try again later.", :too_many_requests }

    # The form fields: every Excel column in file order with its input kind.
    def fields
      render json: { data: ManualOrders::Save.fields }
    end

    def show
      render json: { data: Serializers.order_row(ManualOrder.active.find(params[:id]), source: true) }
    end

    def create
      save(ManualOrder.new, "manual_order.created", :created)
    end

    def update
      save(ManualOrder.active.find(params[:id]), "manual_order.updated", :ok)
    end

    def destroy
      order = ManualOrder.active.find(params[:id])
      order.update!(deleted_at: Time.current, updated_by: current_user)
      audit("manual_order.deleted", subject: order, po_number: order.po_number, part_number: order.part_number,
            order_type: order.order_type)
      head :no_content
    end

    private

    def save(order, action, status)
      result = ManualOrders::Save.call(order: order, values: params.require(:values).permit(*ManualOrder::HEADERS), user: current_user,
                                       confirmed: ActiveModel::Type::Boolean.new.cast(params[:confirmed]) || false)
      unless result.valid?
        return render_error("The order has #{result.errors.size} problem(s).", :unprocessable_content,
                            code: "invalid_order", details: result.errors)
      end
      unless result.saved
        return render_error("Check the warnings, then save again to continue.", :conflict,
                            code: "confirmation_required", details: result.warnings)
      end

      audit(action, subject: result.order, po_number: result.order.po_number, part_number: result.order.part_number,
            order_type: result.order.order_type, warnings: result.warnings.map { |w| w[:code] })
      render json: { data: Serializers.order_row(result.order, source: true), warnings: result.warnings }, status: status
    end
  end
end
