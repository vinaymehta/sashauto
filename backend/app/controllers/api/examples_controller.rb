module Api
  # Example files for the uploads, as .xlsx with the columns each upload reads and a few sample rows: GET
  # /api/examples/:kind. Given `po_number` / `part_number` (an upload opened from a PO or an order), the sample rows are
  # for that PO and part, so the file can be filled in from them.
  class ExamplesController < ApplicationController
    KINDS = {
      "vendor_po_list" => "Example vendor PO list",
      "purchase_received" => "Example purchase received",
      "dispatched_list" => "Example dispatched orders list",
      "invoice_inc" => "Example SASH Inc invoice to Deere",
      "invoice_india" => "Example SASH India invoice"
    }.freeze

    def show
      kind = params[:kind].to_s
      return render_error("Unknown example.", :not_found) unless KINDS.key?(kind)

      po = params[:po_number].to_s.strip.first(32).presence || "4500123456"
      part = OrderRows::Normalizer.part_number(params[:part_number].to_s.first(64)).presence || "JXAW30717"
      headers, rows = send("#{kind}_sheet", po, part)
      send_data ExcelExport::XlsxWriter.call(headers, rows, sheet_name: "Example"), filename: "#{KINDS.fetch(kind).parameterize}.xlsx",
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment"
    end

    private

    def vendor_po_list_sheet(po, part)
      [ [ %w[Type PO\ Number PO\ Line\ Number Part\ Number Ship\ Date Vendor\ Name PO\ Qty\ Issued Purchase\ Order\ No. PO\ Date] ],
        [ [ "Firm", po, "00010", part, "2026-12-15", "Example Vendor Pvt Ltd", 500, "EXV/0001/26-27", "2026-11-20" ],
          [ "Order", po, "00020", part, "2027-01-10", "Example Vendor Pvt Ltd", 250, "EXV/0002/26-27", "2026-11-20" ] ] ]
    end

    def purchase_received_sheet(_po, part)
      [ [ [ "Vendor Invoice Date", "Vendor Invoice No.", "Part", "Description", "Quantity", "Rate", "Value" ] ],
        [ [ "2026-11-24", "INV-1001", part, "Example Vendor Pvt Ltd", 500, 12.5, 6250 ],
          [ "2026-11-25", "INV-1002", part, "Example Vendor Pvt Ltd", 250, 12.5, 3125 ] ] ]
    end

    def dispatched_list_sheet(po, part)
      [ [ [ "SASH PART", "POnumber", "Invoice Number", "Invoice Date", "SHIP DATE REQD", "Qty" ] ],
        [ [ part, po, "EX/26-27/001", "2026-11-20", "2026-12-15", 500 ] ] ]
    end

    def invoice_inc_sheet(po, part) = invoice_sheet("SASH Autotech, Inc.", "John Deere", "SINC/26-27/001", po, part)
    def invoice_india_sheet(po, part) = invoice_sheet("Sash Autotech Pvt. Ltd.", "Lotus Automotive", "EX/26-27/001", po, part)

    # The export invoice layout the reader looks for: Exporter, Invoice No. & Date, a "PO No.… dt.…" line, item rows
    # (Part, description, Quantity with its unit, price, amount) and a total.
    def invoice_sheet(exporter, consignee, number, po, part)
      [ [ [ "Exporter" ], [ exporter ], [ "Consignee" ], [ consignee ],
          [ "Invoice No. & Date" ], [ number, "29.11.2026" ], [ "Sr", "Part No.", "Description", "Quantity", "Unit", "Price", "Amount" ] ],
        [ [ "PO No.#{po} dt.20.11.2026" ], [ 1, part, "Example part", 500, "Nos.", 10.55, 5275 ], [ "", "", "", 500, "", "Total USD", 5275 ] ] ]
    end
  end
end
