"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { VendorEmailStatus, VendorOrderState } from "@/lib/types";
import { formatDateTime, formatQty } from "@/lib/format";
import { AlertIcon } from "../icons";
import { useSession } from "../session";
import { useApi } from "../use-api";
import { useToast } from "../toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert, Spinner } from "../ui/feedback";
import { formatPrice } from "../vendors/vendor-products-panel";

const QTY = /^\d+(\.\d{1,3})?$/;
// Quantities are compared in thousandths so decimal totals add up exactly (Qty has 3 decimals).
const milli = (value: string) => Math.round(Number(value) * 1000);
const fromMilli = (value: number) => formatQty(String(value / 1000));

// Vendor orders of one order row: before placement the buyer (admin) selects vendors linked to the part and
// splits the order Qty among them (the total must equal the Qty; below-MOQ allocations are only warned about).
// After placement the Vendor Orders (VPO-…) are shown, locked, with each vendor's email status.
// `manual`: the order is a manual order (same flow; its id is a manual order id).
export function VendorOrderSection({ orderId, manual = false }: { orderId: number; manual?: boolean }) {
  const path = `/api/orders/${orderId}/vendor_order${manual ? "?manual=1" : ""}`;
  const { data, error, loading, reload } = useApi<{ data: VendorOrderState }>(path);
  const state = data?.data;

  // Refresh while vendor emails are still being sent.
  const pending = state?.placement?.vendor_orders.some((vo) => vo.email_status === "pending");
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(reload, 4000);
    return () => clearTimeout(timer);
  }, [pending, data, reload]);

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Vendor order</h3>
        {state && (
          <span className="text-xs text-ink-muted">
            Order Qty <span className="tabular font-semibold text-ink">{state.order.qty !== null ? formatQty(state.order.qty) : "—"}</span>
            {" · "}MOQ <span className="tabular font-semibold text-ink">{state.moq !== null ? formatQty(state.moq) : "—"}</span>
          </span>
        )}
      </header>
      {error ? (
        <div className="p-4"><Alert title="Could not load the vendor order">{error.message}</Alert></div>
      ) : loading && !state ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !state ? null : state.placement ? (
        <PlacedOrders state={state} onChanged={reload} />
      ) : state.can_place ? (
        <AllocationForm state={state} path={path} onPlaced={reload} />
      ) : (
        <p className="px-5 py-6 text-sm text-ink-muted">
          {state.order.qty === null || Number(state.order.qty) <= 0
            ? "This order has no Qty to place with vendors."
            : state.vendors.length === 0 ? "No vendor is linked to this part." : "Not placed with vendors yet."}
        </p>
      )}
    </section>
  );
}

function AllocationForm({ state, path, onPlaced }: { state: VendorOrderState; path: string; onPlaced: () => void }) {
  const notify = useToast();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.vendors.length === 0) {
    return <p className="px-5 py-6 text-sm text-ink-muted">No vendor is linked to this part. Link one on the Vendors page to place this order.</p>;
  }

  const orderQty = milli(state.order.qty ?? "0");
  const selected = state.vendors.filter((v) => qty[v.vendor_id] !== undefined);
  const invalid = selected.filter((v) => !QTY.test(qty[v.vendor_id]!.trim()) || milli(qty[v.vendor_id]!) <= 0);
  const total = selected.reduce((sum, v) => sum + (QTY.test(qty[v.vendor_id]!.trim()) ? milli(qty[v.vendor_id]!) : 0), 0);
  const remaining = orderQty - total;
  const moq = state.moq !== null ? milli(state.moq) : null;
  const belowMoq = moq === null ? [] : selected.filter((v) => QTY.test(qty[v.vendor_id]!.trim()) && milli(qty[v.vendor_id]!) < moq);
  const ready = selected.length > 0 && invalid.length === 0 && remaining === 0;

  // Selecting a vendor starts it with the quantity not yet allocated (editable).
  function toggle(vendorId: number) {
    setQty((current) => {
      const next = { ...current };
      if (next[vendorId] !== undefined) delete next[vendorId];
      else next[vendorId] = remaining > 0 ? String(remaining / 1000) : "";
      return next;
    });
  }

  async function place() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ warnings: { message: string }[] }>(path, {
        allocations: selected.map((v) => ({ vendor_id: v.vendor_id, qty: qty[v.vendor_id]!.trim() })),
      });
      notify(`${selected.length} vendor order${selected.length === 1 ? "" : "s"} placed. Emails are being sent to the vendors.`);
      if (res.warnings.length) notify(`Placed below MOQ: ${res.warnings.map((w) => w.message).join(" ")}`, "error");
      setConfirming(false);
      onPlaced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the vendor orders.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ul className="divide-y divide-neutral-100">
        {state.vendors.map((v) => {
          const checked = qty[v.vendor_id] !== undefined;
          const value = qty[v.vendor_id] ?? "";
          const bad = checked && (!QTY.test(value.trim()) || milli(value) <= 0);
          return (
            <li key={v.vendor_id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-2.5 text-sm">
              <input type="checkbox" checked={checked} onChange={() => toggle(v.vendor_id)} aria-label={`Select ${v.vendor_name}`}
                     className="h-4 w-4 accent-[var(--color-accent)]" />
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{v.vendor_name}</span>
                <span className="block text-xs text-ink-muted">
                  {formatPrice(v) ?? "No price"}{!v.has_email && <span className="ml-1.5 text-age-yellow-ink" title="The order email goes to the default recipient from .env, to forward to the vendor">· no email, sent to default recipient</span>}
                </span>
              </span>
              <input type="text" inputMode="decimal" value={value} disabled={!checked} placeholder="Qty" aria-label={`Quantity for ${v.vendor_name}`}
                     aria-invalid={bad || undefined}
                     onChange={(e) => setQty((current) => ({ ...current, [v.vendor_id]: e.target.value }))}
                     className={`tabular h-8 w-28 rounded-md border bg-white px-2.5 text-right text-sm text-ink transition-colors focus:outline-none disabled:bg-neutral-50 disabled:text-ink-faint ${
                       bad ? "border-dec" : "border-neutral-300 hover:border-neutral-400 focus:border-neutral-500"}`} />
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ink-muted">
            Allocated <span className="tabular font-semibold text-ink">{fromMilli(total)}</span> of{" "}
            <span className="tabular font-semibold text-ink">{fromMilli(orderQty)}</span>
          </span>
          <span className={`tabular text-xs font-semibold ${remaining === 0 ? "text-inc" : "text-dec"}`}>
            {remaining === 0 ? "Fully allocated" : remaining > 0 ? `${fromMilli(remaining)} left to allocate` : `${fromMilli(-remaining)} over the order Qty`}
          </span>
        </div>
        {belowMoq.length > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-age-yellow px-3 py-2 text-xs text-age-yellow-ink">
            <AlertIcon size={14} className="mt-px shrink-0" />
            <span>
              Below the MOQ of {formatQty(state.moq!)}: {belowMoq.map((v) => `${v.vendor_name} (${formatQty(qty[v.vendor_id]!)})`).join(", ")}.
              You can still place the order, or change the allocation.
            </span>
          </p>
        )}
        {invalid.length > 0 && <p className="text-xs text-dec">Enter a quantity greater than 0 (up to 3 decimals) for each selected vendor.</p>}
        <div className="flex justify-end pt-1">
          <Button variant="primary" size="sm" disabled={!ready} onClick={() => { setError(null); setConfirming(true); }}>
            Place vendor order{selected.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog title={`Place ${selected.length} vendor order${selected.length === 1 ? "" : "s"}?`} tone="primary"
                       confirmLabel="Place orders" busyLabel="Placing…" busy={busy} error={error}
                       onConfirm={place} onCancel={() => setConfirming(false)}>
          <ul className="mt-1 space-y-0.5">
            {selected.map((v) => <li key={v.vendor_id}>{v.vendor_name}: <span className="tabular font-semibold text-ink">{formatQty(qty[v.vendor_id]!)}</span></li>)}
          </ul>
          <p className="mt-2">Each vendor is emailed its own order. After placing, the allocation is locked.</p>
          {belowMoq.length > 0 && <p className="mt-2 font-medium text-age-yellow-ink">{belowMoq.length} allocation{belowMoq.length === 1 ? " is" : "s are"} below the MOQ.</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}

const EMAIL_BADGE: Record<VendorEmailStatus, { tone: "up" | "warn" | "down" | "neutral"; label: string }> = {
  sent: { tone: "up", label: "Email sent" },
  pending: { tone: "warn", label: "Sending" },
  failed: { tone: "down", label: "Email failed" },
  no_email: { tone: "down", label: "No recipient" },
};

function PlacedOrders({ state, onChanged }: { state: VendorOrderState; onChanged: () => void }) {
  const notify = useToast();
  const placement = state.placement!;
  const [retrying, setRetrying] = useState<number | null>(null);
  const admin = useSession().user?.role === "admin";

  async function retry(id: number) {
    setRetrying(id);
    try {
      await api.post(`/api/vendor_orders/${id}/retry_email`);
      notify("Vendor email queued again.");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not retry the email.", "error");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div>
      <ul className="divide-y divide-neutral-100">
        {placement.vendor_orders.map((vo) => {
          const badge = EMAIL_BADGE[vo.email_status];
          return (
            <li key={vo.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{vo.number}</span>
                <span className="block truncate text-xs text-ink-muted">{vo.vendor_name}{vo.email_recipient ? ` · ${vo.email_recipient}` : ""}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular font-semibold text-ink">{formatQty(vo.qty)}</span>
                <span title={vo.email_last_error ?? (vo.email_sent_at ? `Sent ${formatDateTime(vo.email_sent_at)}` : undefined)}>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </span>
                {admin && (vo.email_status === "failed" || vo.email_status === "no_email") && (
                  <Button size="sm" onClick={() => retry(vo.id)} disabled={retrying === vo.id}>{retrying === vo.id ? "Retrying…" : "Retry"}</Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {state.warnings.length > 0 && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-md bg-age-yellow px-3 py-2 text-xs text-age-yellow-ink">
          <AlertIcon size={14} className="mt-px shrink-0" />
          <span>Placed below the MOQ of {formatQty(placement.moq!)}: {state.warnings.map((w) => w.vendor_name).join(", ")}.</span>
        </p>
      )}
      <p className="border-t border-neutral-100 bg-neutral-50 px-5 py-2.5 text-xs text-ink-muted">
        Placed{placement.placed_by ? ` by ${placement.placed_by}` : ""} on {formatDateTime(placement.placed_at)} · locked, cannot be edited
        {placement.order_qty ? ` · original Qty ${formatQty(placement.order_qty)}` : ""}
      </p>
    </div>
  );
}
