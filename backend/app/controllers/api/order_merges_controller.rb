module Api
  # Orders an admin adds by hand to a combined order (Orders::Merges), or takes out of it: an order taken out stays
  # on its own (an order added by hand goes back to normal, unless that would put it straight back into this combined
  # order). Not possible once the PO is generated.
  class OrderMergesController < ApplicationController
    # POST /api/orders/:order_id/merges  { member_ids: [...] } — :order_id is the combined order's first order.
    def create
      anchor = OrderRow.find(params[:order_id])
      candidates = Orders::Merges.candidates(anchor, Orders::Combiner.call(anchor.upload_batch_id)).index_by(&:id)
      ids = Array(params[:member_ids]).map { |id| Integer(id, exception: false) }.uniq
      return render_error("Choose the orders to add.", :unprocessable_content) if ids.empty?
      return render_error("These orders cannot be added to this combined order.", :unprocessable_content) unless ids.all? { |id| candidates[id] }

      anchor_key = VendorOrderPlacement.order_key(anchor)
      if ids.any? { |id| VendorOrderPlacement.order_key(candidates[id]) == anchor_key }
        return render_error("An order cannot be added to itself.", :unprocessable_content)
      end

      OrderMerge.transaction do
        ids.each do |id|
          member_key = VendorOrderPlacement.order_key(candidates[id])
          OrderMerge.where(member_key: member_key, kind: "removed").delete_all # putting back an order taken out
          OrderMerge.create!(anchor_key: anchor_key, member_key: member_key, group_key: anchor.group_key, kind: "added",
                             added_by: current_user)
        end
      end
      audit("order.merged", subject: anchor, po_number: anchor.po_number, part_number: anchor.part_number,
            added: ids.map { |id| { po_line_number: candidates[id].po_line_number, ship_date: candidates[id].ship_date } })
      head :no_content
    rescue ActiveRecord::RecordNotUnique
      render_error("One of these orders was already added to a combined order.", :conflict)
    end

    # DELETE /api/orders/:order_id/merges/:id — :id is an order of the combined order (not its first order).
    def destroy
      anchor = OrderRow.find(params[:order_id])
      member = OrderRow.find(params[:id])
      anchor_key = VendorOrderPlacement.order_key(anchor)
      member_key = VendorOrderPlacement.order_key(member)
      if VendorOrderPlacement.exists?(order_key: anchor_key)
        return render_error("The PO of this combined order is generated, so it cannot be changed.", :unprocessable_content)
      end
      group = Orders::Combiner.call(anchor.upload_batch_id).groups[anchor.id]
      unless group && member.id != anchor.id && group.members.any? { |m| m.id == member.id }
        return render_error("This order is not part of this combined order.", :unprocessable_content)
      end

      added = OrderMerge.find_by(anchor_key: anchor_key, member_key: member_key, kind: "added")
      OrderMerge.transaction do
        added&.destroy!
        # Undoing a manual add of an order the automatic combining would put back into this order: take it out for
        # real, so one click always takes it out.
        if added.nil? || Orders::Combiner.new(anchor.upload_batch_id).call.groups[anchor.id]&.members&.any? { |m| m.id == member.id }
          OrderMerge.create!(anchor_key: anchor_key, member_key: member_key, group_key: anchor.group_key, kind: "removed",
                             added_by: current_user)
        end
      end
      audit("order.merge_removed", subject: anchor, po_number: anchor.po_number, part_number: anchor.part_number,
            removed: { po_line_number: member.po_line_number, ship_date: member.ship_date })
      head :no_content
    end
  end
end
