"use client";

import { can } from "@/lib/permissions";
import { useState } from "react";
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
import { OrderDetailsBody } from "./order-details-modal";
import { VendorOrderSection } from "./vendor-order-section";
import { FileIcon, PencilIcon, TrashIcon, TruckIcon } from "../icons";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dash = <span className="text-neutral-300">—</span>;

// Original imported cell value, lightly formatted for reading (blank cells shown as a dash).
export function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return dash;
  }
  if (typeof value === "string" && ISO_DATE.test(value)) return formatDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.replace("T", " ").slice(0, 16);
  return typeof value === "string" ? value.trim() : value.toLocaleString("en-US");
}

// Order details panel (75% of the screen), opened by clicking a PO Number in the Orders table: the ORDER DETAILS
// view (header fields + every row of the same PO Number + Part Number + Type) and the delivery marks. An Admin can
// edit (`onEdit`) or delete a manual order here. Vendor orders are placed from the row (see PlaceOrderPanel).
export function OrderDetailPanel({ row, onClose, onEdit, onDeleted, onPlaced }: {
  row: OrderRow; onClose: () => void; onEdit?: () => void; onDeleted?: () => void; onPlaced?: () => void;
}) {
  const { data, error, loading, reload } = useApi<OrderHistory>(`/api/orders/${row.id}/history`, { manual: row.manual ? 1 : undefined });
  const admin = can(useSession().user, "orders", "edit"); // Orders edit permission
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
      wide
      onClose={onClose}
      title="Order details"
      description={<>PO <span className="font-medium text-ink">{row.po_number}</span> · {row.part_number} · {row.order_type}{row.manual && <> · <Badge>Manual</Badge></>}</>}
      icon={<FileIcon size={18} />}
    >
      {row.manual && admin && (
        <div className="mb-4 flex justify-end gap-2">
          <Button size="sm" onClick={onEdit}><PencilIcon size={14} className="text-ink-muted" />Edit</Button>
          <Button size="sm" onClick={() => setDeleting(true)}><TrashIcon size={14} className="text-ink-muted" />Delete</Button>
        </div>
      )}
      {error ? (
        <Alert title="Could not load the order">{error.message}</Alert>
      ) : loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <OrderDetailsBody row={row} rows={data?.data ?? [row]} description={data?.group.description ?? null} combined={data?.combined}
                          group={data?.group}
                          onChanged={() => { reload(); onPlaced?.(); }} />
      )}
      <DeliveryMarks row={row} admin={admin} onChanged={onPlaced} />
      {deleting && (
        <ConfirmDialog title={`Delete order PO ${row.po_number}?`} busy={busy} error={deleteError}
                       onConfirm={remove} onCancel={() => setDeleting(false)}>
          The manual order is removed from Orders. Its detected changes and alerts stay in the history.
        </ConfirmDialog>
      )}
    </Sheet>
  );
}

// Inbound / outbound delivery marks of the order (from the Orders list row). An admin can remove a wrong mark.
function DeliveryMarks({ row, admin, onChanged }: { row: OrderRow; admin: boolean; onChanged?: () => void }) {
  const notify = useToast();
  const marks = Object.values(row.deliveries ?? {}).filter((d) => d !== undefined);
  const [removed, setRemoved] = useState<number[]>([]);
  const shown = marks.filter((d) => !removed.includes(d.id));
  if (shown.length === 0) return null;

  async function remove(id: number, label: string) {
    try {
      await api.delete(`/api/order_deliveries/${id}`);
      setRemoved((r) => [...r, id]);
      notify(`"${label}" mark removed.`);
      onChanged?.();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not remove the mark.", "error");
    }
  }

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <h3 className="border-b border-neutral-100 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Delivery</h3>
      <ul className="divide-y divide-neutral-100">
        {shown.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="block font-medium text-ink">{d.label} · {formatDate(d.delivered_on)}</span>
              <span className="block truncate text-xs text-ink-muted">{d.marked_by ?? "—"}{d.note ? ` · ${d.note}` : ""}</span>
            </span>
            {admin && <Button size="sm" onClick={() => remove(d.id, d.label)}>Remove</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Side panel opened by clicking an order row: place the order with vendors (or see its placed vendor orders).
export function PlaceOrderPanel({ row, onClose, onPlaced }: { row: OrderRow; onClose: () => void; onPlaced?: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Place order" icon={<TruckIcon size={18} />}
           description={<>PO <span className="font-medium text-ink">{row.po_number}</span> · {row.part_number} · {row.order_type} · ship {formatDate(row.ship_date)}
             {row.qty !== null && <> · Qty {formatQty(row.qty)}</>}</>}>
      <VendorOrderSection key={row.id} orderId={row.id} manual={!!row.manual} onPlaced={onPlaced} />
    </Sheet>
  );
}
