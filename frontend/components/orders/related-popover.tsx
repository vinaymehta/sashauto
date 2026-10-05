"use client";

import { useState } from "react";
import type { RelatedItem } from "@/lib/types";
import { BoxIcon, FileIcon } from "../icons";
import { useApi } from "../use-api";
import { Spinner } from "../ui/feedback";
import { Sheet } from "../ui/sheet";

// Clickable PO Number / Part Number. Opens the right-hand side panel listing the related Part Numbers
// (for a PO) or PO Numbers (for a Part), fetched from the server for the shown upload (`uploadId`;
// undefined = the current order data).
export function RelatedLink({ kind, value, uploadId }: { kind: "po" | "part"; value: string; uploadId?: number }) {
  const [open, setOpen] = useState(false);

  function openPanel(e: React.MouseEvent) {
    e.stopPropagation(); // do not open the row's history
    setOpen(true);
  }

  return (
    <>
      <button type="button" onClick={openPanel}
              className="font-medium text-ink underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
        {value}
      </button>
      {open && (
        <span onClick={(e) => e.stopPropagation()}>
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            title={kind === "po" ? `PO ${value}` : `Part ${value}`}
            description={kind === "po" ? "Part Numbers on this PO in the current order data." : "PO Numbers that include this part in the current order data."}
            icon={kind === "po" ? <FileIcon size={18} /> : <BoxIcon size={18} />}
          >
            <RelatedList kind={kind} value={value} uploadId={uploadId} />
          </Sheet>
        </span>
      )}
    </>
  );
}

function RelatedList({ kind, value, uploadId }: { kind: "po" | "part"; value: string; uploadId?: number }) {
  const { data, error, loading } = useApi<{ data: RelatedItem[] }>(
    kind === "po" ? "/api/orders/by_po" : "/api/orders/by_part", { ...(kind === "po" ? { po: value } : { part: value }), upload_id: uploadId },
  );
  const items = data?.data ?? [];
  const noun = kind === "po" ? "Part Number" : "PO Number";

  if (error) return <p className="text-sm text-down">{error.message}</p>;
  if (loading && !data) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{noun}s</h3>
        <span className="text-xs text-ink-muted">{items.length} {noun.toLowerCase()}{items.length === 1 ? "" : "s"}</span>
      </header>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-muted">Nothing found.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {items.map((item) => (
            <li key={item.value} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="font-medium text-ink">{item.value}</span>
              <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                {item.types.map((t) => <span key={t} className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700">{t}</span>)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
