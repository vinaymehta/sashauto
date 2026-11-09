"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatCount, formatDate } from "@/lib/format";
import type { DispatchImportResult } from "@/lib/types";
import { TruckIcon, UploadIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Sheet } from "../ui/sheet";
import { Table, Td, Th } from "../ui/table";

// Orders → Actions → Import dispatched list (admin): SASH India's List of Dispatched Orders or Book 38 (.xlsx). The
// orders it matches (PO + Part + Ship Date or Due Date; when the file's PO does not fit, the Part's order on that date
// under our PO) are marked Dispatched with their invoice numbers; the rows marked under our PO and the rows it skipped
// (with the reason, to be marked by hand) are listed. Importing the same file again only skips what is already marked.
export function DispatchImportPanel({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const notify = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(DispatchImportResult & { filename: string }) | null>(null);

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post<{ data: DispatchImportResult }>("/api/order_deliveries/import", form);
      setResult({ ...data, filename: file.name });
      notify(`${formatCount(data.orders_marked)} order${data.orders_marked === 1 ? "" : "s"} marked Dispatched` +
             `${data.skipped.length ? `, ${formatCount(data.skipped.length)} row${data.skipped.length === 1 ? "" : "s"} skipped` : ""}.`,
             data.skipped.length ? "error" : "success");
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The import failed.");
    } finally {
      setImporting(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Sheet open wide onClose={onClose} title="Import dispatched list" icon={<TruckIcon size={18} />}
           description="SASH India's List of Dispatched Orders or Book 38: matching orders are marked Dispatched with their invoice number."
           footer={<>
             <Button variant="ghost" onClick={onClose} disabled={importing}>Close</Button>
             <Button variant="primary" onClick={() => input.current?.click()} disabled={importing}>
               <UploadIcon size={15} />{importing ? "Importing…" : result ? "Import another file" : "Choose .xlsx file"}
             </Button>
           </>}>
      <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!result ? (
        <div className="space-y-2 text-sm text-ink-muted">
          <p>Two files can be imported:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>List of Dispatched Orders</b>: columns <b>SASH PART</b>, <b>POnumber</b>, <b>Invoice Number</b>, <b>Invoice Date</b> and <b>SHIP DATE REQD</b> (DTP) or <b>Due Date</b> (GMBH); <b>Qty</b> helps when a PO + Part has several orders on that date.</li>
            <li><b>Book 38</b>: columns <b>Part</b>, <b>Calc Sales Order No</b>, <b>SHIP DATE REQD</b> and the shipments (<b>Invoice No</b> + <b>Qty</b>). It has no invoice date: the date of that SASH India invoice when it was uploaded, else today. Orders with nothing shipped are left out.</li>
          </ul>
          <p>Each row is matched to the order with the same PO Number and Part Number whose Ship Date or Due Date is that date, in the current order data. When the file&apos;s PO has no such order, the PO in our order data is used: the order of that Part Number on that date. A row of a combined order marks the combined order. An order sent on several invoices gets all of them.</p>
          <p>Rows that match no order, or several, and orders already dispatched are skipped and listed here, to be marked by hand.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            <b>{result.filename}</b>: {formatCount(result.rows)} rows · <b>{formatCount(result.orders_marked)}</b> order{result.orders_marked === 1 ? "" : "s"} marked
            Dispatched (from {formatCount(result.rows_marked)} row{result.rows_marked === 1 ? "" : "s"}) · <b>{formatCount(result.skipped.length)}</b> skipped
          </p>
          {result.po_corrected.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
              <header className="border-b border-neutral-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-ink">Matched under our PO</h3>
                <p className="mt-0.5 text-xs text-ink-muted">The file named another PO; the order of this Part Number on that date in our order data was used.</p>
              </header>
              <Table dense minWidth="min-w-[640px]">
                <thead>
                  <tr><Th align="right">Row</Th><Th>Part Number</Th><Th>Date</Th><Th>Invoice</Th><Th>PO in the file</Th><Th>Our PO (used)</Th></tr>
                </thead>
                <tbody>
                  {result.po_corrected.map((c, i) => (
                    <tr key={`${c.row}-${i}`}>
                      <Td align="right" className="tabular text-ink-muted">{c.row}</Td>
                      <Td>{c.part_number ?? "—"}</Td>
                      <Td className="whitespace-nowrap">{c.date ? formatDate(c.date) : "—"}</Td>
                      <Td className="whitespace-nowrap">{c.invoice_number ?? "—"}</Td>
                      <Td className="tabular text-ink-muted line-through decoration-neutral-300">{c.file_po ?? "—"}</Td>
                      <Td className="tabular font-medium">{c.po_number}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          )}
          {result.skipped.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
              <header className="border-b border-neutral-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-ink">Skipped rows</h3>
                <p className="mt-0.5 text-xs text-ink-muted">Not marked: set their status by hand on the Orders page if needed.</p>
              </header>
              <Table dense minWidth="min-w-[760px]">
                <thead>
                  <tr><Th align="right">Row</Th><Th>PO Number</Th><Th>Part Number</Th><Th>Date</Th><Th>Invoice</Th><Th>Reason</Th></tr>
                </thead>
                <tbody>
                  {result.skipped.map((s, i) => (
                    <tr key={`${s.row}-${i}`}>
                      <Td align="right" className="tabular text-ink-muted">{s.row}</Td>
                      <Td className="tabular">{s.po_number ?? "—"}</Td>
                      <Td>{s.part_number ?? "—"}</Td>
                      <Td className="whitespace-nowrap">{s.date ? formatDate(s.date) : "—"}</Td>
                      <Td className="whitespace-nowrap">{s.invoice_number ?? "—"}</Td>
                      <Td className="text-ink-muted">{s.reason}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}
