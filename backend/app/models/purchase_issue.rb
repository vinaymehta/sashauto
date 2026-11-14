# A row of an uploaded vendor PO list or Purchase Received file that could not be recorded, with why (reason_kind:
# vendor, order, recorded, forecast, qty, received, other) and the row (`row_data`). On the Purchase orders page's Import
# issues tab: a row whose vendor was not found can be given a vendor (an existing one, or added) and recorded; any can
# be dismissed and a dismissed one reopened.
class PurchaseIssue < ApplicationRecord
  STATUSES = %w[open resolved dismissed].freeze

  belongs_to :vendor_po_import
  belongs_to :resolved_by, class_name: "User", optional: true

  validates :status, inclusion: { in: STATUSES }
  scope :open, -> { where(status: "open") }

  # Opens an issue for a row of an upload, unless the same row (file kind, business, part, PO, vendor, vendor PO /
  # invoice, Qty) already has one with the same reason, whatever its status (open, dismissed, or resolved: e.g. its
  # vendor was chosen by hand): uploading a file again does not repeat its issues.
  def self.record!(import, row, reason, reason_kind)
    data = row.transform_values { |v| v.is_a?(Date) ? v.iso8601 : v.is_a?(BigDecimal) ? v.to_s("F") : v }
    print = fingerprint_of(import.kind, import.business, data, reason)
    return if where(fingerprint: print).exists?

    create!(vendor_po_import: import, business: import.business, excel_row: row[:row], reason: reason, reason_kind: reason_kind,
            row_data: data, fingerprint: print)
  end

  # Closes the open issues of this row (file kind, business, part, PO, vendor, vendor PO / invoice, Qty: any reason)
  # once an upload recorded it, e.g. after its vendor was added or its vendor PO uploaded.
  def self.close_for!(kind, business, row, user)
    data = row.transform_values { |v| v.is_a?(Date) ? v.iso8601 : v.is_a?(BigDecimal) ? v.to_s("F") : v }.stringify_keys
    match = { "part_number" => data["part_number"], "vendor" => data["vendor"] }
    match["po_number"] = data["po_number"] if data["po_number"]
    match[kind == "received" ? "invoice_number" : "vendor_po"] = data[kind == "received" ? "invoice_number" : "vendor_po"]
    open.joins(:vendor_po_import).where(business: business, vendor_po_imports: { kind: kind })
        .where("purchase_issues.row_data @> ?", match.to_json)
        .find_each { |issue| issue.close!("resolved", user: user, resolution: "recorded") }
  end

  def self.fingerprint_of(kind, business, data, reason)
    data = data.stringify_keys
    Digest::SHA256.hexdigest([ kind, business, data["part_number"], data["po_number"], data["po_line_number"], data["date"],
                               data["vendor"].to_s.squish.downcase, data["vendor_po"] || data["invoice_number"], data["issued"] || data["qty"],
                               reason ].join("\u001f"))
  end

  def close!(status, user:, resolution: nil)
    update!(status: status, resolution: resolution, resolved_by: user, resolved_at: Time.current)
  end

  def reopen!
    update!(status: "open", resolution: nil, resolved_by: nil, resolved_at: nil)
  end
end
