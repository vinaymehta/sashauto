"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OrderRow } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { ageGroup } from "../age";
import { BoxIcon, MapPinIcon } from "../icons";

type Source = OrderRow["source_data"];

// One Excel cell of a row, trimmed; null when blank.
function src(data: Source, key: string) {
  const value = data?.[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

const price = (value: string | null) => (value === null || Number.isNaN(Number(value)) ? value : Number(value).toFixed(2));

// Opens the order details panel for a row (provided by the Orders page).
export const OpenOrderContext = createContext<(row: OrderRow) => void>(() => undefined);

// PO Number in the Orders table. Clicking it opens the order details panel (supplier-portal layout).
export function OrderDetailsLink({ row }: { row: OrderRow }) {
  const open = useContext(OpenOrderContext);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open(row); }}
            className="font-medium text-ink underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
      {row.po_number}
    </button>
  );
}

const AGE_DOT = { green: "bg-age-green-ink", yellow: "bg-age-yellow-ink", red: "bg-age-red-ink" } as const;
const AGE_DOT_TITLE = { green: "30–45 days to ship date", yellow: "15–29 days to ship date", red: "Under 15 days to ship date, or overdue" } as const;

const COLUMNS: { label: string; value: (r: OrderRow, description: string | null) => ReactNode; align?: "right" }[] = [
  { label: "Deere Part Number", value: (r) => r.part_number },
  { label: "Order Type", value: (r) => r.order_type },
  { label: "Due Date", value: (r) => (r.due_date ? formatDate(r.due_date) : null) },
  { label: "Ship Date", value: (r) => formatDate(r.ship_date) },
  { label: "Quantity", value: (r) => (r.qty === null ? null : formatQty(r.qty)), align: "right" },
  { label: "UOM", value: () => null },
  { label: "Price", value: (r) => price(src(r.source_data, "Unit Price")), align: "right" },
  { label: "Unit of Price", value: () => null },
  { label: "Currency", value: () => null },
  { label: "Description", value: (_, description) => description },
  { label: "Supplier Part Number", value: (r) => r.supplier_part_number },
  { label: "Last Receipt Date", value: (r) => (r.last_receipt_date ? formatDate(r.last_receipt_date) : null) },
  { label: "Last Receipt Quantity", value: (r) => (r.last_receipt_qty === null ? null : formatQty(r.last_receipt_qty)), align: "right" },
  { label: "Shipment ID", value: () => null },
  { label: "Packing List Number", value: (r) => r.last_packing_list_number },
  { label: "Engineering Change Level", value: (r) => src(r.source_data, "EC Level") },
  { label: "International Harmonized Commodity Code", value: () => null },
  { label: "Manufacturer", value: () => null },
  { label: "Container Code", value: () => null },
  { label: "Qty per Container", value: () => null },
  { label: "Dock Code", value: (r) => r.dock_number },
];

// Order details content, in the app's card and table style: the order's facts (only fields the file has), its
// Ship To address, and every row of the same PO Number + Part Number + Type (`rows`, the clicked row highlighted).
export function OrderDetailsBody({ row, rows, description }: { row: OrderRow; rows: OrderRow[]; description: string | null }) {
  const s = row.source_data;
  const cityLine = [src(s, "Ship to City"), [src(s, "Ship to Region"), src(s, "Ship to PostalCode")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [src(s, "Ship to Name"), src(s, "Ship To Address"), cityLine || null].filter(Boolean);
  const facts = ([
    ["PO Line", row.po_line_number],
    ["Supplier Part Number", row.supplier_part_number],
    ["Unit", row.unit?.trim() || null],
  ] as [string, string | null][]).filter(([, value]) => value);
  // Every column of the supplier-portal order view, also when the file has no value for it.
  const columns = COLUMNS;
  const today = new Date();

  return (
    <div className="space-y-4">
      {/* Order: part details, with Ship To below them in the same card */}
      <section className="overflow-hidden rounded-lg border border-line bg-gradient-to-br from-tint-violet/70 via-white to-white shadow-card">
        <div className="flex min-w-0 items-start gap-4 px-5 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-tint-violet-ink shadow-card ring-1 ring-tint-violet-ink/15">
            <BoxIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight text-ink">{row.part_number}</h3>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-tint-violet-ink ring-1 ring-tint-violet-ink/20">{row.order_type}</span>
            </div>
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line">PO <span className="tabular font-semibold text-ink">{row.po_number}</span></span>
              {facts.map(([label, v]) => (
                <span key={label} className="max-w-full truncate rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line" title={v ?? undefined}>
                  {label} <span className="font-semibold text-ink">{v}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/70 bg-white/60 px-5 py-3 text-sm">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            <MapPinIcon size={13} className="text-tint-violet-ink" />
            Ship To
          </span>
          {address.length ? (
            <address className="min-w-0 not-italic text-ink">
              <span className="font-semibold">{address[0]}</span>
              {address.length > 1 && <span className="text-ink-muted">, {address.slice(1).join(", ")}</span>}
            </address>
          ) : (
            <span className="text-ink-faint">Not in the file</span>
          )}
        </div>
      </section>

      {/* Schedule, full width */}
      <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Schedule</h3>
          <span className="text-xs text-ink-muted">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th aria-label="Age" className="h-10 w-8 border-b border-neutral-200 bg-neutral-50 pl-5" />
                {columns.map((c) => (
                  <th key={c.label} className={`h-10 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-3 text-xs font-bold uppercase tracking-wider text-neutral-800 last:pr-5 ${
                    c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const age = ageGroup(r.ship_date, today);
                return (
                  <tr key={r.id} className={r.id === row.id ? "bg-accent/5" : "hover:bg-neutral-50/60"} aria-current={r.id === row.id || undefined}>
                    <td className="h-11 border-b border-neutral-100 pl-5">
                      <span title={age ? AGE_DOT_TITLE[age] : "More than 45 days to ship date"}
                            className={`block h-2.5 w-2.5 rounded-full ${age ? AGE_DOT[age] : "bg-neutral-200"}`} />
                    </td>
                    {columns.map((c) => (
                      <td key={c.label} className={`h-11 whitespace-nowrap border-b border-neutral-100 px-3 text-ink last:pr-5 ${
                        c.align === "right" ? "tabular text-right" : ""} ${r.id === row.id ? "font-semibold" : ""}`}>
                        {c.value(r, description) ?? <span className="text-neutral-300">—</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
