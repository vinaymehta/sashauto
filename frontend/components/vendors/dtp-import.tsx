"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { VendorImportResult } from "@/lib/types";
import { UploadIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";

// Button that uploads a DTP Details workbook (.xlsx). The import fills the product fields (SASH Part,
// Vendor Part, Description, MOQ, Per Pc Weight) and the vendors with their prices. Used on Products and Vendors.
export function DtpImportButton({ label = "Import Excel", onImported }: { label?: string; onImported: (result: VendorImportResult) => void }) {
  const notify = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const { data: r } = await api.post<{ data: VendorImportResult }>("/api/vendors/import", form);
      notify(`Import complete: ${r.added} part${r.added === 1 ? "" : "s"} added, ${r.updated} updated, ${r.vendors_created} new vendor${r.vendors_created === 1 ? "" : "s"}${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`,
             r.skipped.length ? "error" : "success");
      onImported(r);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "The import failed.", "error");
    } finally {
      setImporting(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      <Button onClick={() => input.current?.click()} disabled={importing} title="Upload a DTP Details .xlsx file">
        <UploadIcon size={15} className="text-ink-muted" />{importing ? "Importing…" : label}
      </Button>
    </>
  );
}

// Lists the rows an import skipped (e.g. Part Number not in Products), if any.
export function DtpImportSkipped({ result }: { result: VendorImportResult | null }) {
  if (!result || result.skipped.length === 0) return null;
  return (
    <div className="mb-4">
      <Alert title={`${result.skipped.length} row${result.skipped.length === 1 ? " was" : "s were"} skipped`}>
        <ul className="mt-1 list-disc pl-5">
          {result.skipped.slice(0, 10).map((s) => <li key={s.row}>Excel row {s.row}: {s.message}</li>)}
        </ul>
      </Alert>
    </div>
  );
}
