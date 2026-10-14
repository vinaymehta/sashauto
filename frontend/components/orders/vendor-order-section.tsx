"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { OrderUnit, ProductVendor, VendorEmailStatus, VendorOrderState } from "@/lib/types";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { AlertIcon } from "../icons";
import { useSession } from "../session";
import { useApi } from "../use-api";
import { useToast } from "../toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert, Spinner } from "../ui/feedback";
import { DatePicker } from "../ui/date-picker";
import { formatAmount, formatPrice } from "../vendors/vendor-products-panel";

const QTY = /^\d+(\.\d{1,3})?$/;
// Quantities are compared in thousandths so decimal totals add up exactly (Qty has 3 decimals).
const milli = (value: string) => Math.round(Number(value) * 1000);
const fromMilli = (value: number) => formatQty(String(value / 1000));

// Vendor orders of one order row: before placement the buyer (admin) selects vendors linked to the part and
// splits the order Qty among them (the total must equal the Qty; below-MOQ allocations are only warned about).
// After placement the Vendor Orders (VPO-…) are shown, locked, with each vendor's email status.
// `manual`: the order is a manual order (same flow; its id is a manual order id).
// `onPlaced`: called after the order is placed (e.g. to show the "Order placed" tag in the Orders list).
export function VendorOrderSection({ orderId, manual = false, onPlaced }: { orderId: number; manual?: boolean; onPlaced?: () => void }) {
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
            {state.order.combined ? <> (combined from {state.order.combined} orders)</> : null}
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
        <AllocationForm state={state} path={path} onPlaced={() => { reload(); onPlaced?.(); }} />
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

// ship_date: YYYY-MM-DD for this vendor's order; starts as the order's Ship Date and can be changed.
type Allocation = { qty: string; unit: OrderUnit; ship_date: string };

// One vendor line: its price and MOQ in the unit the allocation is entered in.
function unitInfo(v: ProductVendor, unit: OrderUnit, fallbackMoq: { sets: string | null; pcs: string | null }) {
  const pack = Math.max(v.pack_size ?? 1, 1);
  const price = formatAmount(unit === "pcs" ? v.price_amount : v.set_price_amount, v.price_currency);
  const moq = unit === "pcs" ? v.moq ?? fallbackMoq.pcs : v.moq_sets ?? fallbackMoq.sets;
  return { pack, price, moq };
}

function AllocationForm({ state, path, onPlaced }: { state: VendorOrderState; path: string; onPlaced: () => void }) {
  const notify = useToast();
  const [alloc, setAlloc] = useState<Record<number, Allocation>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.vendors.length === 0) {
    return <p className="px-5 py-6 text-sm text-ink-muted">No vendor is linked to this part. Link one on the Vendors page to place this order.</p>;
  }

  const fallbackMoq = { sets: state.moq, pcs: state.moq_pcs };
  const orderQty = milli(state.order.qty ?? "0"); // in sets
  const selected = state.vendors.filter((v) => alloc[v.vendor_id] !== undefined);
  const valid = (a: Allocation) => QTY.test(a.qty.trim()) && milli(a.qty) > 0;
  const datesSet = selected.every((v) => alloc[v.vendor_id]!.ship_date !== "");
  const invalid = selected.filter((v) => !valid(alloc[v.vendor_id]!));
  // Order Qty counts sets: an allocation in pieces counts as pieces ÷ that vendor's pack size.
  const inSets = (v: ProductVendor, a: Allocation) => (a.unit === "pcs" ? Math.round(milli(a.qty) / Math.max(v.pack_size ?? 1, 1)) : milli(a.qty));
  const total = selected.reduce((sum, v) => sum + (valid(alloc[v.vendor_id]!) ? inSets(v, alloc[v.vendor_id]!) : 0), 0);
  const remaining = orderQty - total;
  const belowMoq = selected.filter((v) => {
    const a = alloc[v.vendor_id]!;
    const { moq } = unitInfo(v, a.unit, fallbackMoq);
    return valid(a) && moq !== null && milli(a.qty) < milli(moq);
  });
  const ready = selected.length > 0 && invalid.length === 0 && remaining === 0;

  // Selecting a vendor starts it with the sets not yet allocated (editable, in sets).
  function toggle(vendorId: number) {
    setAlloc((current) => {
      const next = { ...current };
      if (next[vendorId] !== undefined) delete next[vendorId];
      else next[vendorId] = { qty: remaining > 0 ? String(remaining / 1000) : "", unit: "sets", ship_date: state.order.ship_date };
      return next;
    });
  }

  // Switching the unit converts the quantity, so the same amount stays allocated.
  function setUnit(v: ProductVendor, unit: OrderUnit) {
    setAlloc((current) => {
      const a = current[v.vendor_id]!;
      if (a.unit === unit) return current;
      const pack = Math.max(v.pack_size ?? 1, 1);
      const n = Number(a.qty);
      const qty = QTY.test(a.qty.trim()) ? String(unit === "pcs" ? +(n * pack).toFixed(3) : +(n / pack).toFixed(3)) : a.qty;
      return { ...current, [v.vendor_id]: { ...a, qty, unit } };
    });
  }

  async function place() {
    if (!datesSet) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ warnings: { message: string }[] }>(path, {
        allocations: selected.map((v) => ({
          vendor_id: v.vendor_id, qty: alloc[v.vendor_id]!.qty.trim(), unit: alloc[v.vendor_id]!.unit, ship_date: alloc[v.vendor_id]!.ship_date,
        })),
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

  const describe = (v: ProductVendor) => {
    const a = alloc[v.vendor_id]!;
    const { pack } = unitInfo(v, a.unit, fallbackMoq);
    return a.unit === "pcs" ? `${formatQty(a.qty)} pcs` : pack > 1 ? `${formatQty(a.qty)} sets (${formatQty(String(Number(a.qty) * pack))} pcs)` : formatQty(a.qty);
  };

  // Review step, in the same panel: each vendor's quantity and ship date, then Place orders (or Back to edit).
  if (confirming) {
    return (
      <div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm font-semibold text-ink">Review {selected.length} vendor order{selected.length === 1 ? "" : "s"}</p>
          {error && <Alert>{error}</Alert>}
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-line">
            {selected.map((v) => {
              const a = alloc[v.vendor_id]!;
              return (
                <li key={v.vendor_id} className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{v.vendor_name}</span>
                    <span className="tabular block text-sm text-ink-muted">{describe(v)}</span>
                  </span>
                  <span className="text-sm">
                    <span className="mb-1 block text-xs font-medium text-ink-muted">Ship date</span>
                    <DatePicker value={a.ship_date} invalid={!a.ship_date} aria-label={`Ship date for ${v.vendor_name}`} className="w-44"
                                onChange={(day) => setAlloc((current) => ({ ...current, [v.vendor_id]: { ...current[v.vendor_id]!, ship_date: day } }))} />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-ink-muted">
            Order ship date: <span className="font-medium text-ink">{formatDate(state.order.ship_date)}</span>. Change a vendor&apos;s date to ask
            for a different shipment date; the vendor&apos;s email shows its date.
          </p>
          {!datesSet && <p className="text-sm text-dec">Choose a ship date for each vendor.</p>}
          {belowMoq.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-age-yellow px-3 py-2 text-sm text-age-yellow-ink">
              <AlertIcon size={14} className="mt-0.5 shrink-0" />
              {belowMoq.length} allocation{belowMoq.length === 1 ? " is" : "s are"} below the MOQ. You can still place the order.
            </p>
          )}
          <p className="text-sm text-ink-muted">Each vendor is emailed its own order. After placing, the allocation and dates are locked.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
          <Button size="sm" variant="primary" onClick={place} disabled={busy || !datesSet}>{busy ? "Placing…" : "Place orders"}</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-neutral-100">
        {state.vendors.map((v) => {
          const a = alloc[v.vendor_id];
          const checked = a !== undefined;
          const unit = a?.unit ?? "sets";
          const { pack, price, moq } = unitInfo(v, unit, fallbackMoq);
          const bad = checked && !valid(a);
          return (
            <li key={v.vendor_id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-2.5 text-sm">
              <input type="checkbox" checked={checked} onChange={() => toggle(v.vendor_id)} aria-label={`Select ${v.vendor_name}`}
                     className="h-4 w-4 accent-[var(--color-accent)]" />
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{v.vendor_name}</span>
                <span className="block text-xs text-ink-muted">
                  {price ? `${price} / ${unit === "pcs" ? "pc" : pack > 1 ? `set of ${pack}` : "pc"}` : formatPrice(v) ?? "No price"}
                  {moq !== null && ` · MOQ ${formatQty(moq)} ${unit === "pcs" || pack <= 1 ? "pcs" : "sets"}`}
                  {!v.has_email && <span className="ml-1.5 text-age-yellow-ink" title="The order email goes to the default recipient from .env, to forward to the vendor">· no email, sent to default recipient</span>}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <input type="text" inputMode="decimal" value={a?.qty ?? ""} disabled={!checked} placeholder="Qty" aria-label={`Quantity for ${v.vendor_name}`}
                       aria-invalid={bad || undefined}
                       onChange={(e) => setAlloc((current) => ({ ...current, [v.vendor_id]: { ...current[v.vendor_id]!, qty: e.target.value } }))}
                       className={`tabular h-8 w-24 rounded-md border bg-white px-2.5 text-right text-sm text-ink transition-colors focus:outline-none disabled:bg-neutral-50 disabled:text-ink-faint ${
                         bad ? "border-dec" : "border-neutral-300 hover:border-neutral-400 focus:border-neutral-500"}`} />
                {pack > 1 ? (
                  <select value={unit} disabled={!checked} aria-label={`Unit for ${v.vendor_name}`} onChange={(e) => setUnit(v, e.target.value as OrderUnit)}
                          className="h-8 rounded-md border border-neutral-300 bg-white px-1.5 text-sm text-ink disabled:bg-neutral-50 disabled:text-ink-faint">
                    <option value="sets">Sets</option>
                    <option value="pcs">Pcs</option>
                  </select>
                ) : <span className="w-[3.25rem] text-xs text-ink-muted">pcs</span>}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ink-muted">
            Allocated <span className="tabular font-semibold text-ink">{fromMilli(total)}</span> of{" "}
            <span className="tabular font-semibold text-ink">{fromMilli(orderQty)}</span>{state.pack_size > 1 ? " sets" : ""}
            {state.pack_size > 1 && <span className="ml-1 text-xs">({fromMilli(orderQty * state.pack_size)} pcs)</span>}
          </span>
          <span className={`tabular text-xs font-semibold ${remaining === 0 ? "text-inc" : "text-dec"}`}>
            {remaining === 0 ? "Fully allocated" : remaining > 0 ? `${fromMilli(remaining)} left to allocate` : `${fromMilli(-remaining)} over the order Qty`}
          </span>
        </div>
        {belowMoq.length > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-age-yellow px-3 py-2 text-xs text-age-yellow-ink">
            <AlertIcon size={14} className="mt-px shrink-0" />
            <span>
              Below the MOQ: {belowMoq.map((v) => {
                const { moq } = unitInfo(v, alloc[v.vendor_id]!.unit, fallbackMoq);
                const u = alloc[v.vendor_id]!.unit === "pcs" || (v.pack_size ?? 1) <= 1 ? "pcs" : "sets";
                return `${v.vendor_name} (${formatQty(alloc[v.vendor_id]!.qty)} of ${formatQty(moq!)} ${u})`;
              }).join(", ")}. You can still place the order, or change the allocation.
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
                <span className="block truncate text-xs text-ink-muted">
                  {vo.vendor_name}{vo.ship_date ? ` · ship ${formatDate(vo.ship_date)}` : ""}{vo.email_recipient ? ` · ${vo.email_recipient}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular font-semibold text-ink">{formatQty(vo.qty)} {vo.unit === "pcs" || state.pack_size <= 1 ? "pcs" : "sets"}</span>
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
          <span>Placed below the MOQ: {state.warnings.map((w) => w.message).join(" ")}</span>
        </p>
      )}
      <p className="border-t border-neutral-100 bg-neutral-50 px-5 py-2.5 text-xs text-ink-muted">
        Placed{placement.placed_by ? ` by ${placement.placed_by}` : ""} on {formatDateTime(placement.placed_at)} · locked, cannot be edited
        {placement.order_qty ? ` · original Qty ${formatQty(placement.order_qty)}` : ""}
      </p>
    </div>
  );
}
