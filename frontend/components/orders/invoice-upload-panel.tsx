"use client";

import { Fragment, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { BUSINESS_LABEL } from "@/lib/business";
import { formatDate, formatQty } from "@/lib/format";
import type { InvoiceKind, InvoicePreview } from "@/lib/types";
import { CheckIcon, FileIcon, TruckIcon, UploadIcon } from "../icons";
import { useToast } from "../toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Sheet } from "../ui/sheet";
import { Table, Td, Th } from "../ui/table";

// What each kind of invoice does, for the panel's texts once the file is read.
const KIND_TEXT: Record<InvoiceKind, { from: string; moves: string; before: string; after: string }> = {
  india: { from: "SASH Autotech Pvt. Ltd. (India) to Lotus Automotive", moves: "dispatched",
           before: "Shipped before", after: "Shipped after" },
  inc: { from: "SASH Autotech, Inc. (US) to John Deere", moves: "outbound (delivered to Deere)",
         before: "Outbound before", after: "Outbound after" },
};

// Orders → Actions → Upload invoice (admin): a SASH India or SASH Inc export invoice as .pdf or .xlsx; the file says
// which (its Exporter).
// The file is read and shown first (Preview): each line (PO, Part, Qty) with the order rows of that PO + Part it goes
// to, oldest Ship Date first, and the Qty no order takes (unmatched, with the reason). Save records the invoice: SASH
// India moves the Qty to dispatched, SASH Inc moves dispatched Qty to outbound. An invoice uploaded before is refused.
export function InvoiceUploadPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const kind = preview?.kind ?? null;
  const text = kind ? KIND_TEXT[kind] : null;
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = (chosen: File) => {
    const body = new FormData();
    body.append("file", chosen);
    return body;
  };

  async function read(chosen: File | undefined) {
    if (input.current) input.current.value = "";
    if (!chosen) return;
    setFile(chosen);
    setPreview(null);
    setSaved(false);
    setError(null);
    setBusy("reading");
    try {
      const { data } = await api.post<{ data: InvoicePreview }>("/api/invoices/preview", form(chosen));
      setPreview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The invoice could not be read.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!file) return;
    setBusy("saving");
    setError(null);
    try {
      // Read and allocated again on save: the preview is what it does unless orders changed meanwhile.
      const { data } = await api.post<{ data: InvoicePreview }>("/api/invoices", form(file));
      setPreview(data);
      setSaved(true);
      notify(`Invoice ${data.invoice_number} saved: Qty ${formatQty(data.matched_qty)} ${kind === "india" ? "dispatched" : "outbound"}` +
             `${Number(data.unmatched_qty) > 0 ? `, ${formatQty(data.unmatched_qty)} unmatched` : ""}.`,
             Number(data.unmatched_qty) > 0 ? "error" : "success");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The invoice could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open wide onClose={onClose} title={preview ? `Upload ${preview.label}` : "Upload invoice"} icon={<TruckIcon size={18} />}
           description={text ? `Export invoice from ${text.from}: its Qty becomes ${text.moves}, oldest Ship Date first.`
             : "A SASH India invoice moves its Qty to dispatched, a SASH Inc invoice moves dispatched Qty to outbound: the file says which."}
           footer={<>
             <Button variant="ghost" onClick={onClose} disabled={busy !== null}>Close</Button>
             <Button onClick={() => input.current?.click()} disabled={busy !== null}>
               <UploadIcon size={15} className="text-ink-muted" />{busy === "reading" ? "Reading…" : file ? "Choose another file" : "Choose .pdf or .xlsx"}
             </Button>
             {preview && !saved && (
               <Button variant="primary" onClick={save} disabled={busy !== null || Number(preview.matched_qty) <= 0}>
                 {busy === "saving" ? "Saving…" : "Save invoice"}
               </Button>
             )}
           </>}>
      <input ref={input} type="file" accept=".pdf,.xlsx" hidden onChange={(e) => read(e.target.files?.[0])} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!preview ? (
        <div className="space-y-2 text-sm text-ink-muted">
          <p>Choose the invoice as <b>PDF</b> or as the <b>Excel</b> file it is made in. It is read and shown here first; nothing changes until you save it.</p>
          <p>Each item line (<b>PO No.</b> above it, <b>Part No.</b>, <b>Quantity</b>) goes to the orders of that PO + Part, oldest Ship Date first:
            {" "}a <b>SASH India</b> invoice gives each order its Balance (Order Qty less what was shipped before), a <b>SASH Inc</b>{" "}
            invoice what was dispatched on SASH India invoices and is not yet outbound, until the line&apos;s Qty is used up.
            {" "}Qty no order takes is listed as unmatched.</p>
          <p>The PDF of the invoice template is checked; Excel files are read by the same labels (Invoice No. &amp; Date, PO No., Part No., Quantity) and are not yet checked against a real invoice workbook, so look at the preview carefully.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-lg border border-line bg-white px-5 py-4 shadow-card">
            <div className="flex flex-wrap items-center gap-2">
              <FileIcon size={16} className="text-ink-muted" />
              <span className="text-lg font-semibold text-ink">{preview.invoice_number}</span>
              <Badge>{preview.label}</Badge>
              {saved && <Badge tone="up">Saved</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {formatDate(preview.invoice_date)} · {preview.exporter ?? "—"} · {preview.filename}
            </p>
            <p className="mt-2 text-sm text-ink">
              Qty <b className="tabular">{formatQty(preview.total_qty)}</b> on {preview.lines.length} line{preview.lines.length === 1 ? "" : "s"} ·{" "}
              <b className="tabular">{formatQty(preview.matched_qty)}</b> {saved ? "" : "to be "}{kind === "india" ? "dispatched" : "outbound"}
              {Number(preview.unmatched_qty) > 0 && <> · <b className="tabular text-dec">{formatQty(preview.unmatched_qty)}</b> unmatched</>}
            </p>
          </section>
          {preview.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
          <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
            <header className="border-b border-neutral-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Lines and the orders they go to</h3>
              <p className="mt-0.5 text-xs text-ink-muted">Under each invoice line: the order rows of its PO + Part that take its Qty, oldest Ship Date first.</p>
            </header>
            <Table dense minWidth="min-w-[860px]">
              <thead>
                <tr><Th>PO Number</Th><Th>Part Number</Th><Th>PO Line · Ship Date</Th><Th align="right">Order Qty</Th><Th align="right">{text?.before}</Th>
                  <Th align="right">Qty</Th><Th align="right">{text?.after}</Th><Th align="right">{kind === "india" ? "Balance" : "Not delivered yet"}</Th></tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <Fragment key={line.index}>
                    <tr className="bg-neutral-50">
                      <Td className="tabular font-semibold">{line.po_number ?? "—"}</Td>
                      <Td className="font-semibold"><span title={line.description ?? undefined}>{line.part_number}</span></Td>
                      <Td className="text-ink-muted">Invoice line {line.index + 1}{line.description ? ` · ${line.description}` : ""}</Td>
                      <Td /><Td />
                      <Td align="right" className="tabular font-semibold">{formatQty(line.qty)}</Td>
                      <Td /><Td />
                    </tr>
                    {line.allocations.map((a) => (
                      <tr key={`${a.manual ? "m" : "r"}${a.order_id}`}>
                        <Td /><Td className="text-ink-muted">{a.order_type}{a.manual ? " · Manual" : ""}{a.business ? ` · ${BUSINESS_LABEL[a.business]}` : ""}</Td>
                        <Td className="whitespace-nowrap">Line {a.po_line_number} · {formatDate(a.ship_date)}</Td>
                        <Td align="right" className="tabular">{formatQty(a.order_qty)}</Td>
                        <Td align="right" className="tabular text-ink-muted">{formatQty(a.before)}</Td>
                        <Td align="right" className="tabular font-semibold text-inc">+{formatQty(a.qty)}</Td>
                        <Td align="right" className="tabular">{formatQty(a.after)}</Td>
                        <Td align="right" className="tabular">{formatQty(a.left)}</Td>
                      </tr>
                    ))}
                    {line.unmatched_qty && (
                      <tr>
                        <Td /><Td colSpan={4} className="text-dec">Unmatched: {line.reason}</Td>
                        <Td align="right" className="tabular font-semibold text-dec">{formatQty(line.unmatched_qty)}</Td>
                        <Td /><Td />
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </section>
          {saved ? (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted"><CheckIcon size={14} className="text-inc" />
              Saved. The unmatched Qty is kept on the invoice; each order shows its invoices in Order details.</p>
          ) : Number(preview.matched_qty) <= 0 ? (
            <Alert tone="warning">No order takes any of this invoice&apos;s Qty, so there is nothing to save.</Alert>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
