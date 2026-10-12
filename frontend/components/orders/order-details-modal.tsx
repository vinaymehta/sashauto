"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OrderRow } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";

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

// ORDER DETAILS content: the order's header fields and every row of the same PO Number + Part Number + Type
// (`rows`, the clicked row in bold). Fields the order file does not have (Purpose Code, Incoterms, Buyer, UOM,
// Currency, …) are shown blank.
export function OrderDetailsBody({ row, rows, description }: { row: OrderRow; rows: OrderRow[]; description: string | null }) {
  const s = row.source_data;
  const cityLine = [src(s, "Ship to City"), [src(s, "Ship to Region"), src(s, "Ship to PostalCode")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [src(s, "Ship to Name"), src(s, "Ship To Address"), cityLine || null].filter(Boolean);

  const header: [string, ReactNode][] = [
    ["Supplier", null],
    ["Unit", row.unit?.trim() || null],
    ["PO Number", row.po_number],
    ["Date", null],
    ["Purpose Code", null],
    ["Reference ID", null],
    ["Incoterms", null],
    ["Ship To Address", address.length ? address.map((line, i) => <span key={i} className="block">{line}</span>) : null],
    ["Buyer", null],
    ["Planner", null],
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white text-[13px] text-neutral-900 shadow-card">
      <h3 className="bg-neutral-300/80 px-4 py-3 text-2xl font-bold uppercase tracking-tight text-neutral-700">Order Details</h3>
      <div className="px-4 pb-4">
        <dl className="grid grid-cols-[9.5rem_1fr] gap-x-2 gap-y-2 py-3">
          {header.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-bold">{label}</dt>
              <dd className="min-h-[1.25rem]">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-neutral-300/70">
                {COLUMNS.map((c) => (
                  <th key={c.label} className="min-w-20 border border-white px-2 py-2 text-center align-middle font-bold leading-tight">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={`${i % 2 === 1 ? "bg-[#eef3ec]" : "bg-white"} ${r.id === row.id ? "font-semibold" : ""}`}
                    aria-current={r.id === row.id || undefined}>
                  {COLUMNS.map((c) => (
                    <td key={c.label} className={`border-x border-neutral-200 px-2 py-2 align-top ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {c.value(r, description)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
