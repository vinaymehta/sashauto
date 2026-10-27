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

// Orders → Actions → Import dispatched list (admin): SASH India's list of dispatched orders (.xlsx with SASH PART,
// Qty, POnumber, Invoice Number, Invoice Date and SHIP DATE REQD or Due Date). The orders it matches (PO + Part + Ship
// Date or Due Date) are marked Dispatched with their invoice numbers; the rows it skipped are listed with the reason,
// to be marked by hand. Importing the same list again only skips what is already marked.
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
           description="SASH India's list of dispatched orders: matching orders are marked Dispatched with their invoice number."
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
          <p>The file needs the columns <b>SASH PART</b>, <b>POnumber</b>, <b>Invoice Number</b>, <b>Invoice Date</b> and <b>SHIP DATE REQD</b> (DTP) or <b>Due Date</b> (GMBH); <b>Qty</b> helps when a PO + Part has several orders on that date.</p>
          <p>Each row is matched to the order with the same PO Number and Part Number whose Ship Date or Due Date is that date, in the current order data. A row of a combined order marks the combined order. An order sent on several invoices gets all of them.</p>
          <p>Rows that match no order, or several, and orders already dispatched are skipped and listed here, to be marked by hand.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink">
            <b>{result.filename}</b>: {formatCount(result.rows)} rows · <b>{formatCount(result.orders_marked)}</b> order{result.orders_marked === 1 ? "" : "s"} marked
            Dispatched (from {formatCount(result.rows_marked)} row{result.rows_marked === 1 ? "" : "s"}) · <b>{formatCount(result.skipped.length)}</b> skipped
          </p>
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
                  {result.skipped.map((s) => (
                    <tr key={s.row}>
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
