"use client";

import { useRef, useState } from "react";
import type { VendorPoImportInfo } from "@/lib/types";
import { api, ApiError } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { Sheet } from "../ui/sheet";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { ExampleLink } from "../ui/example-link";
import { useToast } from "../toast";
import { UploadIcon } from "../icons";

const KINDS = {
  orders: {
    title: "Upload vendor PO", example: "vendor_po_list" as const, path: "/api/purchase_orders/import", noun: "vendor PO",
    text: "The Deere order dump with Vendor Name, PO Qty Issued and the vendor PO number. Each listed order gets that vendor PO.",
  },
  received: {
    title: "Upload purchase received", example: "purchase_received" as const, path: "/api/purchase_orders/import_received", noun: "receipt row",
    text: "The Purchase Received file: Vendor Invoice Date, Vendor Invoice No., Part, vendor, Quantity. Each row's Qty goes to the vendor POs of that part and vendor.",
  },
};

// The slider of a vendor PO list / Purchase Received upload: what the file is, its example, and Choose file. With `po`
// (and `part`) only the rows of that PO (and part) are taken from the file.
export function ListUploadSheet({ kind, po, part, onClose, onDone }: {
  kind: keyof typeof KINDS; po?: string; part?: string; onClose: () => void; onDone: (result: VendorPoImportInfo) => void;
}) {
  const k = KINDS[kind];
  const notify = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = po ? (part ? `PO ${po} · ${part}` : `PO ${po}`) : null;

  async function upload(chosen: File | undefined) {
    if (file.current) file.current.value = "";
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", chosen);
    if (po) form.append("po_number", po);
    if (po && part) form.append("part_number", part);
    try {
      const { data } = await api.post<{ data: VendorPoImportInfo }>(k.path, form);
      notify(`${what ? `${what}: ` : ""}${formatCount(data.created)} ${k.noun}${data.created === 1 ? "" : "s"} recorded` +
             `${data.skipped.length ? `, ${formatCount(data.skipped.length)} row${data.skipped.length === 1 ? "" : "s"} skipped (${data.skipped[0].reason})` : ""}.`,
             data.skipped.length ? "error" : "success");
      onDone(data);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open floating={!!po} onClose={onClose} title={k.title} icon={<UploadIcon size={18} />}
           description={what ? `Only the rows of ${what} are taken from the file.` : "One business at a time: choose DTP or GMBH first."}
           footer={<>
             <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
             <Button variant="primary" onClick={() => file.current?.click()} disabled={busy}>
               <UploadIcon size={15} />{busy ? "Uploading…" : "Choose .xlsx file"}
             </Button>
           </>}>
      <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => upload(e.target.files?.[0])} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="space-y-3 text-sm text-ink-muted">
        <p>{k.text}</p>
        {what && <p>Rows of other POs{part ? " or parts" : ""} in the file are left out, so no other order is touched.</p>}
        <p>Nothing already recorded is overwritten. Rows that could not be recorded are listed with the reason.</p>
        <p><ExampleLink kind={k.example} po={po} part={part} label="Download example (.xlsx)" /></p>
      </div>
    </Sheet>
  );
}
