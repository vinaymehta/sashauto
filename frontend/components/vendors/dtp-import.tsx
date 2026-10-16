"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { VendorDetailsImportResult, VendorImportResult } from "@/lib/types";
import { UploadIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";

// Button that uploads an Excel file (.xlsx); the server recognises which one by its headers:
//   * a DTP Details workbook: fills the product fields (SASH Part, Vendor Part, Description, MOQ, Per Pc Weight) and
//     the vendors with their prices (`onImported`);
//   * the vendor details file (Vendor Code, contact, GSTIN, Lead Days, …) or the jurisdictional tax officer file:
//     adds or updates the vendors; rows not saved go to the Import issues tab (`onDetailsImported` gets their count).
// Used on Products and Vendors.
export function DtpImportButton({ label = "Import", onImported, onDetailsImported }: {
  label?: string; onImported: (result: VendorImportResult) => void; onDetailsImported?: (issues: number) => void;
}) {
  const notify = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post<{ data: VendorImportResult | VendorDetailsImportResult }>("/api/vendors/import", form);
      if ("kind" in data) {
        notify(`${data.kind === "details" ? "Vendor details" : "Tax officer addresses"} imported: ` +
               `${data.created ? `${data.created} vendor${data.created === 1 ? "" : "s"} added, ` : ""}${data.updated} updated` +
               `${data.issues ? `. ${data.issues} row${data.issues === 1 ? "" : "s"} to review in Import issues` : ""}.`,
               data.issues ? "error" : "success");
        onDetailsImported?.(data.issues);
        return;
      }
      const r = data;
      notify(`Import complete: ${r.added} part${r.added === 1 ? "" : "s"} added, ${r.updated} updated, ${r.products_created} new product${r.products_created === 1 ? "" : "s"}, ${r.vendors_created} new vendor${r.vendors_created === 1 ? "" : "s"}${r.issues ? `. ${r.issues} issue${r.issues === 1 ? "" : "s"} to review in Import issues` : ""}.`,
             r.issues ? "error" : "success");
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
      <Button onClick={() => input.current?.click()} disabled={importing} title="Import a DTP Details, vendor details or tax officer file">
        <UploadIcon size={15} className="text-ink-muted" />{importing ? "Importing…" : label}
      </Button>
    </>
  );
}
