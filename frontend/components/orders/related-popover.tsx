"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BoxIcon, FileIcon, TruckIcon } from "../icons";
import { useSession } from "../session";
import { Sheet } from "../ui/sheet";
import { VendorSummaryPanel } from "../vendors/vendor-summary";
import { PartSummaryPanel } from "./part-summary";
import { PoSummaryPanel } from "./po-summary";

type Kind = "po" | "part" | "vendor";
// What a summary panel shows: a PO, a Part Number or a vendor (`id`: the vendor's id).
type Target = { kind: Kind; value: string; id?: number; uploadId?: number };

// Set inside an open summary panel: a link there opens its summary in the same panel (with Back) instead of another one.
const OpenInPanel = createContext<((target: Target) => void) | null>(null);

const TITLES: Record<Kind, (value: string) => string> = {
  po: (v) => `PO summary · ${v}`,
  part: (v) => `Product summary · ${v}`,
  vendor: (v) => `Vendor · ${v}`,
};
const ICONS: Record<Kind, ReactNode> = { po: <FileIcon size={18} />, part: <BoxIcon size={18} />, vendor: <TruckIcon size={18} /> };

// Clickable PO Number, Part Number or vendor name. Opens the wide right-hand side panel with its summary: a PO's lines
// (ordered, dispatched, delivered, pending, status, revenue), a part's Product summary (ordered, dispatched,
// delivered, pending; per PO; vendors and prices) or a vendor's parts and details; from the server for the shown upload
// (`uploadId`; undefined = the current order data). Links inside the panel open in the same panel, with a Back button.
// A vendor link needs the vendor's `id`. The Warehouse Manager does not see Product summaries: a part is plain text.
export function RelatedLink({ kind, value, uploadId, id, children }: { kind: Kind; value: string; uploadId?: number; id?: number; children?: ReactNode }) {
  const inPanel = useContext(OpenInPanel);
  const [stack, setStack] = useState<Target[]>([]);
  const top = stack[stack.length - 1];

  function openPanel(e: React.MouseEvent) {
    e.stopPropagation(); // do not open the row's history
    const target = { kind, value, id, uploadId };
    if (inPanel) inPanel(target);
    else setStack([target]);
  }

  const push = (target: Target) => setStack((s) => {
    const last = s[s.length - 1];
    return last && last.kind === target.kind && last.value === target.value ? s : [...s, target];
  });
  const back = stack[stack.length - 2];
  const role = useSession().user?.role;
  if (kind === "part" && role === "warehouse_manager") return <span className="font-medium text-ink">{children ?? value}</span>;

  return (
    <>
      <button type="button" onClick={openPanel} title={`Open the ${kind === "po" ? "PO" : kind === "part" ? "product" : "vendor"} summary`}
              className="text-left font-medium text-ink underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
        {children ?? value}
      </button>
      {/* On <body>, so it is not inside the link's paragraph or table cell and stacks over any panel the link is in;
          React events still bubble to the link's row, hence the stop. */}
      {top && createPortal(
        <div onClick={(e) => e.stopPropagation()}>
          <Sheet
            open
            wide
            floating
            onClose={() => setStack([])}
            title={TITLES[top.kind](top.value)}
            description={top.kind === "vendor" ? "The vendor's parts, prices and details."
              : top.uploadId ? "From the shown upload." : "From the current order data."}
            icon={ICONS[top.kind]}
          >
            <OpenInPanel.Provider value={push}>
              {back && (
                <button type="button" onClick={() => setStack((s) => s.slice(0, -1))}
                        className="mb-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-white hover:text-ink">
                  ← Back to {TITLES[back.kind](back.value)}
                </button>
              )}
              {top.kind === "part" ? <PartSummaryPanel key={`part-${top.value}`} part={top.value} uploadId={top.uploadId} />
                : top.kind === "po" ? <PoSummaryPanel key={`po-${top.value}`} po={top.value} uploadId={top.uploadId} />
                : top.id ? <VendorSummaryPanel key={`vendor-${top.id}`} vendorId={top.id} uploadId={top.uploadId} />
                : <p className="text-sm text-ink-muted">This vendor is not in the vendor list.</p>}
            </OpenInPanel.Provider>
          </Sheet>
        </div>,
        document.body,
      )}
    </>
  );
}
