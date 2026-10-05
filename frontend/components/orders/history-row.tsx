"use client";

import { useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { OrderHistory, OrderRow } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { useSession } from "../session";
import { useToast } from "../toast";
import { useApi } from "../use-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { Sheet } from "../ui/sheet";
import { Tabs } from "../ui/tabs";
import { VendorOrderSection } from "./vendor-order-section";
import { FileIcon, PencilIcon, TrashIcon } from "../icons";

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

// Order detail in the right-hand side panel, in two tabs: Details shows the order; History lists the other
// rows with the same PO Number + Part Number + Type (by PO Line Number, then Ship Date), each identified by
// PO Line Number + Ship Date + Qty; clicking one shows its details in the same panel. The Orders table stays
// visible and clickable behind the panel (no blur); ✕ or Escape closes it. A manual order has no other rows;
// an Admin can edit (`onEdit`) or delete it.
export function OrderDetailPanel({ row: clicked, onClose, onEdit, onDeleted }: {
  row: OrderRow; onClose: () => void; onEdit?: () => void; onDeleted?: () => void;
}) {
  const { data, error, loading } = useApi<OrderHistory>(`/api/orders/${clicked.id}/history`, { manual: clicked.manual ? 1 : undefined });
  const [tab, setTab] = useState<"details" | "history">("details");
  // The row shown: the clicked row, or a related row chosen in History (same group, so the list is shared).
  const [row, setRow] = useState(clicked);
  const description = data?.group.description ?? null;
  const history = data ? data.data.filter((r) => r.id !== row.id) : [];
  const admin = useSession().user?.role === "admin";
  const notify = useToast();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/manual_orders/${row.id}`);
      notify(`Order PO ${row.po_number} deleted.`);
      onDeleted?.();
      onClose();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the order.");
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      overlay={false}
      onClose={onClose}
      title="Order details"
      description={<>PO <span className="font-medium text-ink">{row.po_number}</span> · {row.order_type}{row.manual && <> · <Badge>Manual</Badge></>}</>}
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
          {row.manual && admin && (
            <div className="mb-4 flex justify-end gap-2">
              <Button size="sm" onClick={onEdit}><PencilIcon size={14} className="text-ink-muted" />Edit</Button>
              <Button size="sm" onClick={() => setDeleting(true)}><TrashIcon size={14} className="text-ink-muted" />Delete</Button>
            </div>
          )}
          <DetailCard row={row} description={description} />
          <VendorOrderSection key={row.id} orderId={row.id} manual={!!row.manual} />
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
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-line bg-white shadow-card">
          {history.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { setRow(r); setTab("details"); }}
                      className="grid w-full grid-cols-3 gap-4 px-5 py-3 text-left text-sm transition-colors hover:bg-canvas">
                <span><span className="block text-2xs font-medium uppercase tracking-wider text-ink-muted">PO Line</span>{r.po_line_number}</span>
                <span><span className="block text-2xs font-medium uppercase tracking-wider text-ink-muted">Ship Date</span>{formatDate(r.ship_date)}</span>
                <span className="text-right"><span className="block text-2xs font-medium uppercase tracking-wider text-ink-muted">Qty</span>{qty(r.qty)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog title={`Delete order PO ${row.po_number}?`} busy={busy} error={deleteError}
                       onConfirm={remove} onCancel={() => setDeleting(false)}>
          The manual order is removed from Orders. Its detected changes and alerts stay in the history.
        </ConfirmDialog>
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
