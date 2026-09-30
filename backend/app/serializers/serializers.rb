# Plain JSON shapes for the API. Quantities are serialized as strings to keep decimal precision.
module Serializers
  module_function

  def user(user)
    { id: user.id, name: user.name, email: user.email, role: user.role }
  end

  def qty(value)
    return nil if value.nil?
    number = value.to_d
    number.frac.zero? ? number.to_i.to_s : number.to_s("F")
  end

  def upload_batch(batch, detail: false)
    data = {
      id: batch.id, version: batch.version_number, status: batch.status,
      original_filename: batch.original_filename, byte_size: batch.byte_size,
      uploaded_by: batch.uploaded_by&.name, uploaded_at: batch.created_at, completed_at: batch.completed_at,
      failed_at: batch.failed_at, row_count: batch.row_count,
      change_count: batch.completed? && batch.previous_upload_batch_id ? batch.increase_count + batch.decrease_count : nil,
      error_message: batch.error_message
    }
    return data unless detail

    data.merge(
      file_sha256: batch.file_sha256, storage_key: batch.file.attached? ? batch.file.blob.key : nil,
      previous_version: batch.previous_upload_batch&.version_number,
      error_code: batch.error_code, warnings: batch.warnings,
      problem_count: batch.validation_errors.size,
      problem_columns: batch.validation_errors.group_by { |e| e["column"] || "_none" }.transform_values(&:size),
      stats: batch.slice(:source_row_count, :row_count, :duplicate_rows_merged, :unknown_quantity_count, :compared_count,
                         :increase_count, :decrease_count, :unchanged_count, :new_row_count, :missing_row_count),
      notification: batch.notification && notification(batch.notification)
    )
  end

  def notification(notification)
    notification.slice(:id, :status, :recipients, :subject, :change_count, :attempts, :last_error, :last_attempt_at, :sent_at)
  end

  def quantity_change(change)
    change.slice(:id, :po_number, :po_line_number, :part_number, :commodity_type, :order_type, :ship_date,
                 :ship_to_location, :direction)
          .merge(old_qty: qty(change.old_qty), new_qty: qty(change.new_qty), difference: qty(change.difference))
  end

  def snapshot_row(row)
    row.slice(:id, :ship_to_location, :order_type, :po_number, :po_line_number, :part_number, :ship_date,
              :commodity_type, :quantity_source, :current_release_number, :source_row_numbers)
       .merge(qty: qty(row.qty), previous_qty: qty(row.previous_qty), effective_qty: qty(row.effective_qty))
  end

  ORDER_ROW_FIELDS = %i[id order_type due_date ship_date unit plant_code po_number po_line_number part_number
                        commodity_type last_asn_date last_receipt_date last_packing_list_number crossdock_location
                        ship_to_location dock_number supplier_part_number last_released_date last_updated_date
                        quantity_source].freeze

  def order_row(row)
    row.slice(*ORDER_ROW_FIELDS).merge(
      qty: qty(row.qty), previous_qty: qty(row.previous_qty),
      last_asn_qty: qty(row.last_asn_qty), last_receipt_qty: qty(row.last_receipt_qty)
    )
  end

  def product(product, open_conflicts: [])
    product.slice(:id, :part_number, :commodity_type, :source, :created_at, :updated_at)
           .merge(open_conflicts: open_conflicts.map { |c| product_conflict(c) })
  end

  def product_conflict(conflict)
    conflict.slice(:id, :product_id, :existing_commodity_type, :incoming_commodity_type, :status, :resolution,
                   :resolved_at, :created_at)
            .merge(version: conflict.upload_batch&.version_number, uploaded_at: conflict.upload_batch&.completed_at)
  end
end
