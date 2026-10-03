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
                         :increase_count, :decrease_count, :unchanged_count, :new_row_count, :missing_row_count,
                         :address_change_count, :moq_alert_count),
      emails: upload_emails(batch)
    )
  end

  EMAIL_ORDER = %w[quantity_changes address_changes moq_alerts ageing].freeze

  # Every email sent for an upload: one per alert kind, plus the ageing digest (the silent baseline
  # run is not an email).
  def upload_emails(batch)
    digests = batch.ageing_digests.reject { |d| d.status == "skipped" }
    (batch.notifications.map { |n| email(n, n.kind, n.count) } + digests.map { |d| email(d, "ageing", d.row_count) })
      .sort_by { |e| EMAIL_ORDER.index(e[:kind]) || EMAIL_ORDER.size }
  end

  def email(record, kind, count)
    record.slice(:id, :status, :recipients, :subject, :attempts, :last_error, :last_attempt_at, :sent_at, :provider_message_id)
          .merge(kind: kind, count: count)
  end

  def quantity_change(change)
    change.slice(:id, :po_number, :po_line_number, :part_number, :commodity_type, :order_type, :ship_date,
                 :ship_to_location, :direction)
          .merge(old_qty: qty(change.old_qty), new_qty: qty(change.new_qty), difference: qty(change.difference))
  end

  def vendor(vendor, product_count: nil)
    vendor.slice(:id, :name, :created_at, :updated_at)
          .merge(product_count: product_count || (vendor.has_attribute?(:product_count) ? vendor[:product_count] : vendor.vendor_products.count))
  end

  def product_vendor(item)
    { id: item.id, vendor_id: item.vendor_id, vendor_name: item.vendor.name, price_amount: qty(item.price_amount),
      price_currency: item.price_currency, price_note: item.price_note }
  end

  def vendor_product(item)
    item.slice(:id, :vendor_id, :product_id, :sash_part, :vendor_part, :description, :price_currency, :price_note, :updated_at)
        .merge(part_number: item.product.part_number, commodity_type: item.product.commodity_type,
               moq: qty(item.moq), weight_kg: qty(item.weight_kg), price_amount: qty(item.price_amount))
  end

  def moq_alert(alert)
    alert.slice(:id, :po_number, :part_number, :order_type, :ship_date).merge(qty: qty(alert.qty), moq: qty(alert.moq))
  end

  def address_change(change)
    change.slice(:id, :po_number, :part_number, :order_type, :ship_date, :old_address, :new_address)
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

  def order_row(row, source: false)
    data = row.slice(*ORDER_ROW_FIELDS).merge(
      qty: qty(row.qty), previous_qty: qty(row.previous_qty),
      last_asn_qty: qty(row.last_asn_qty), last_receipt_qty: qty(row.last_receipt_qty)
    )
    if row.is_a?(OrderRow)
      data[:history_count] = row.group_row_count - 1
      data[:source_row_number] = row.source_row_number
      data[:source_data] = row.source_data if source
    end
    data
  end

  def product(product, open_conflicts: [])
    product.slice(:id, :part_number, :commodity_type, :source, :sash_part, :vendor_part, :description, :created_at, :updated_at)
           .merge(moq: qty(product.moq), weight_kg: qty(product.weight_kg))
           .merge(open_conflicts: open_conflicts.map { |c| product_conflict(c) })
  end

  def product_conflict(conflict)
    conflict.slice(:id, :product_id, :existing_commodity_type, :incoming_commodity_type, :status, :resolution,
                   :resolved_at, :created_at)
            .merge(version: conflict.upload_batch&.version_number, uploaded_at: conflict.upload_batch&.completed_at)
  end
end
