import { DownloadIcon } from "../icons";

export type ExampleKind = "vendor_po_list" | "purchase_received" | "dispatched_list" | "invoice_inc" | "invoice_india";

// "Download example": a sample .xlsx with the columns the upload reads (GET /api/examples/:kind). With `po` / `part`
// the sample rows are for that PO and part.
export function ExampleLink({ kind, po, part, label = "Download example", className = "" }: {
  kind: ExampleKind; po?: string; part?: string; label?: string; className?: string;
}) {
  const query = new URLSearchParams();
  if (po) query.set("po_number", po);
  if (part) query.set("part_number", part);
  const qs = query.toString();
  return (
    <a href={`/api/examples/${kind}${qs ? `?${qs}` : ""}`} download onClick={(e) => e.stopPropagation()}
       className={`inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline ${className}`}>
      <DownloadIcon size={13} />{label}
    </a>
  );
}
