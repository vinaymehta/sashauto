"use client";

import { useState, type ReactNode } from "react";
import type { OrderHistory, OrderRow } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { useApi } from "../use-api";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { Sheet } from "../ui/sheet";
import { Tabs } from "../ui/tabs";
import { VendorOrderSection } from "./vendor-order-section";
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

// Order detail in the right-hand side panel, in two tabs: Details shows the clicked row; History shows the
// other rows with the same PO Number + Part Number + Type (by PO Line Number, then Ship Date).
// Like the other side panels it blurs the page behind it and closes on an outside click, ✕ or Escape.
export function OrderDetailPanel({ row, onClose }: { row: OrderRow; onClose: () => void }) {
  const { data, error, loading } = useApi<OrderHistory>(`/api/orders/${row.id}/history`);
  const [tab, setTab] = useState<"details" | "history">("details");
  const description = data?.group.description ?? null;
  const history = data ? data.data.filter((r) => r.id !== row.id) : [];

  return (
    <Sheet
      open
      onClose={onClose}
      title="Order details"
      description={<>PO <span className="font-medium text-ink">{row.po_number}</span> · {row.order_type}</>}
      icon={<FileIcon size={18} />}
    >
      <div className="-mt-2 mb-4 border-b border-line">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "details" as const, label: "Details" },
            { key: "history" as const, label: "History", count: data ? history.length : null },
          ]}
        />
      </div>

      {tab === "details" ? (
        <>
          <DetailCard row={row} description={description} />
          <VendorOrderSection orderId={row.id} />
        </>
      ) : error ? (
        <Alert title="Could not load the history">{error.message}</Alert>
      ) : loading && !data ? (
        <Skeleton className="h-48 w-full" />
      ) : history.length === 0 ? (
        <p className="rounded-lg border border-line bg-white px-5 py-8 text-center text-sm text-ink-muted shadow-card">
          No other rows for this PO, Part and Type.
        </p>
      ) : (
        <div className="space-y-4">
          {history.map((r) => <DetailCard key={r.id} row={r} description={description} />)}
        </div>
      )}
    </Sheet>
  );
}

function DetailCard({ row, description }: { row: OrderRow; description: string | null }) {
  const details: [string, ReactNode][] = [
    ["Description", description ?? dash],
    ["Item Number", row.part_number],
    ["Due Date", row.due_date ? formatDate(row.due_date) : dash],
    ["Ship Date", formatDate(row.ship_date)],
    ["Quantity Due", qty(row.qty)],
    ["UOM", row.unit?.trim() || dash],
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
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
