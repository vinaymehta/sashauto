"use client";

import type { ReactNode } from "react";
import type { OrderHistory, OrderRow } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { ageRowProps } from "../age";
import { useApi } from "../use-api";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { Sheet } from "../ui/sheet";
import { FileIcon } from "../icons";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dash = <span className="text-neutral-300">—</span>;
const qty = (value: string | null) => (value === null ? dash : formatQty(value));

// Original imported cell value, lightly formatted for reading (blank cells shown as a dash).
export function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return <span className="text-neutral-300">—</span>;
  }
  if (typeof value === "string" && ISO_DATE.test(value)) return formatDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.replace("T", " ").slice(0, 16);
  return typeof value === "string" ? value.trim() : value.toLocaleString("en-US");
}

// Order detail in the right-hand side panel: one detail card per row with the same PO Number + Part Number
// + Type. The clicked row's card comes first and is marked Current; the others follow by PO Line Number and
// Ship Date. The panel has no backdrop, so the Orders table stays visible and clickable.
export function OrderDetailPanel({ row, today, onClose }: { row: OrderRow; today: Date; onClose: () => void }) {
  const { data, error, loading } = useApi<OrderHistory>(`/api/orders/${row.id}/history`);
  const description = data?.group.description ?? null;
  const rows = data ? [row, ...data.data.filter((r) => r.id !== row.id)] : [row];

  return (
    <Sheet
      open
      overlay={false}
      onClose={onClose}
      title="Order details"
      description={<>
        PO <span className="font-medium text-ink">{row.po_number}</span> · {row.order_type}
        {data && <> · {rows.length} row{rows.length === 1 ? "" : "s"}</>}
      </>}
      icon={<FileIcon size={18} />}
    >
      <div className="space-y-4">
        {rows.map((r, index) => <DetailCard key={r.id} row={r} description={description} current={index === 0} today={today} />)}
        {error ? (
          <Alert title="Could not load the other rows">{error.message}</Alert>
        ) : loading && !data ? (
          <Skeleton className="h-48 w-full" />
        ) : null}
      </div>
    </Sheet>
  );
}

function DetailCard({ row, description, current, today }: { row: OrderRow; description: string | null; current: boolean; today: Date }) {
  const age = ageRowProps(row.ship_date, today);
  const details: [string, ReactNode][] = [
    ["Description", description ?? dash],
    ["Item Number", row.part_number],
    ["Due Date", row.due_date ? formatDate(row.due_date) : dash],
    ["Ship Date", formatDate(row.ship_date)],
    ["Quantity Due", qty(row.qty)],
    ["UOM", row.unit?.trim() || dash],
  ];

  return (
    <section className={`overflow-hidden rounded-lg border bg-white shadow-card ${current ? "border-accent/40 ring-1 ring-accent/20" : "border-line"}`}>
      <header className={`flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3 ${age.className}`} title={age.title}>
        <h3 className="text-sm font-semibold text-ink">
          PO Line {row.po_line_number}
          {current && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-accent">Current</span>}
        </h3>
        <span className="tabular text-xs text-ink-muted">Excel row {row.source_row_number}</span>
      </header>
      <dl className="divide-y divide-neutral-100">
        {details.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[9rem_1fr] gap-4 px-5 py-2.5 text-sm">
            <dt className="font-medium text-ink-muted">{label}</dt>
            <dd className="min-w-0 break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
