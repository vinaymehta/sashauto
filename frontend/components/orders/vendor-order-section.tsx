"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { OrderUnit, ProductVendor, VendorOrderInfo, VendorOrderPlacementInfo, VendorOrderState } from "@/lib/types";
import { formatDate, formatDateOnly, formatDateTime, formatQty } from "@/lib/format";
import { AlertIcon, DownloadIcon, FileIcon } from "../icons";
import { useSession } from "../session";
import { useApi } from "../use-api";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Alert, Spinner } from "../ui/feedback";
import { PdfViewer } from "../ui/pdf-viewer";
import { DatePicker } from "../ui/date-picker";
import { formatAmount, formatPrice } from "../vendors/vendor-products-panel";

const QTY = /^\d+(\.\d{1,3})?$/;
// A vendor's ship date defaults to this many days before the order's ship date (time to ship to the customer).
// It can be changed per vendor.
const VENDOR_LEAD_DAYS = 60;
function defaultVendorShipDate(orderShipDate: string) {
  const [y, m, d] = orderShipDate.split("-").map(Number);
  return new Date(y!, m! - 1, d! - VENDOR_LEAD_DAYS).toLocaleDateString("en-CA");
}
// Which draft PDF of a vendor: the purchase order or the Intimation Letter.
type DraftKind = "po" | "letter";

// Quantities are compared in thousandths so decimal totals add up exactly (Qty has 3 decimals).
const milli = (value: string) => Math.round(Number(value) * 1000);
const fromMilli = (value: number) => formatQty(String(value / 1000));

// Vendor orders of one order row: the buyer (admin) selects vendors linked to the part and splits Qty among them;
// a PO can order all or part of the Qty still to order (below-MOQ allocations are only warned about), and the rest
// stays open for later POs. Generated POs (numbers like 5500936312/ZSCTCL/30-04-26) are shown, locked, each with
// its PDF and an "Order placed" tick (POs are not emailed).
// `manual`: the order is a manual order (same flow; its id is a manual order id).
// `onPlaced`: called after the PO is generated (e.g. to show the "PO generated" tag in the Orders list).
export function VendorOrderSection({ orderId, manual = false, onPlaced }: { orderId: number; manual?: boolean; onPlaced?: () => void }) {
  const path = `/api/orders/${orderId}/vendor_order${manual ? "?manual=1" : ""}`;
  const { data, error, loading, reload } = useApi<{ data: VendorOrderState }>(path);
  const state = data?.data;

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Vendor order</h3>
        {state && (
          <span className="text-xs text-ink-muted">
            Order Qty <span className="tabular font-semibold text-ink">{state.order.qty !== null ? formatQty(state.order.qty) : "—"}</span>
            {state.order.combined ? <> (combined from {state.order.combined} orders)</> : null}
            {state.placements.length > 0 && <>{" · "}Ordered <span className="tabular font-semibold text-ink">{formatQty(state.order.ordered)}</span>
              {" · "}Open <span className={`tabular font-semibold ${Number(state.order.remaining) > 0 ? "text-dec" : "text-inc"}`}>{formatQty(state.order.remaining)}</span></>}
            {" · "}MOQ <span className="tabular font-semibold text-ink">{state.moq !== null ? formatQty(state.moq) : "—"}</span>
          </span>
        )}
      </header>
      {error ? (
        <div className="p-4"><Alert title="Could not load the vendor order">{error.message}</Alert></div>
      ) : loading && !state ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !state ? null : (
        <>
          {state.placements.map((p) => <PlacedOrders key={p.id} state={state} placement={p} />)}
          {state.can_place ? (
            <AllocationForm key={state.order.remaining} state={state} path={path} onPlaced={() => { reload(); onPlaced?.(); }} />
          ) : state.placements.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">
              {state.order.qty === null || Number(state.order.qty) <= 0
                ? "This order has no Qty to place with vendors."
                : state.vendors.length === 0 ? "No vendor is linked to this part." : "No PO generated yet."}
            </p>
          ) : Number(state.order.remaining) <= 0 ? (
            <p className="border-t border-neutral-100 px-5 py-3 text-sm font-medium text-inc">Fully ordered.</p>
          ) : null}
        </>
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
  const [preview, setPreview] = useState<{ vendorId: number; url: string; kind: DraftKind } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null); // `${kind}-${vendorId}` being made

  if (state.vendors.length === 0) {
    return <p className="px-5 py-6 text-sm text-ink-muted">No vendor is linked to this part. Link one on the Vendors page to generate its PO.</p>;
  }

  const fallbackMoq = { sets: state.moq, pcs: state.moq_pcs };
  const orderQty = milli(state.order.remaining); // still to order, in sets
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
  // A PO can order part of the Qty; the rest stays open for a later PO.
  const ready = selected.length > 0 && invalid.length === 0 && total > 0 && remaining >= 0;

  // Selecting a vendor starts it with the sets not yet allocated (editable, in sets).
  function toggle(vendorId: number) {
    setAlloc((current) => {
      const next = { ...current };
      if (next[vendorId] !== undefined) delete next[vendorId];
      else next[vendorId] = { qty: remaining > 0 ? String(remaining / 1000) : "", unit: "sets", ship_date: defaultVendorShipDate(state.order.ship_date) };
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

  const allocationsBody = () => selected.map((v) => ({
    vendor_id: v.vendor_id, qty: alloc[v.vendor_id]!.qty.trim(), unit: alloc[v.vendor_id]!.unit, ship_date: alloc[v.vendor_id]!.ship_date,
  }));

  async function place() {
    if (!datesSet) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ warnings: { message: string }[] }>(path, { allocations: allocationsBody() });
      notify(`${selected.length} PO${selected.length === 1 ? "" : "s"} generated. The PDF${selected.length === 1 ? " is" : "s are"} saved.`);
      if (res.warnings.length) notify(`Below MOQ: ${res.warnings.map((w) => w.message).join(" ")}`, "error");
      setConfirming(false);
      onPlaced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate the PO.");
    } finally {
      setBusy(false);
    }
  }

  const describe = (v: ProductVendor) => {
    const a = alloc[v.vendor_id]!;
    const { pack } = unitInfo(v, a.unit, fallbackMoq);
    return a.unit === "pcs" ? `${formatQty(a.qty)} pcs` : pack > 1 ? `${formatQty(a.qty)} sets (${formatQty(String(Number(a.qty) * pack))} pcs)` : formatQty(a.qty);
  };

  // DRAFT purchase order (`po`) or Intimation Letter (`letter`) of one vendor (not saved): shown in the viewer, or
  // (`download`) saved as a file.
  async function draftPdf(vendorId: number, download = false, kind: DraftKind = "po") {
    setPreviewing(`${kind}-${vendorId}`);
    setError(null);
    try {
      const action = kind === "letter" ? "preview_letter" : "preview";
      const blob = await api.postBlob(`${path.split("?")[0]}/${action}${path.includes("?") ? `?${path.split("?")[1]}` : ""}`, {
        vendor_id: vendorId, allocations: allocationsBody(),
      });
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${kind === "letter" ? "intimation-letter" : "purchase-order"}-draft-${state.vendors.find((v) => v.vendor_id === vendorId)?.vendor_name ?? vendorId}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        setPreview((old) => { if (old) URL.revokeObjectURL(old.url); return { vendorId, url, kind }; });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not make the PDF.");
    } finally {
      setPreviewing(null);
    }
  }

  // Review step, in the same panel: each vendor's quantity, ship date and PDF preview or download, then Generate PO
  // (or Back).
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
                <li key={v.vendor_id} className="space-y-3 px-4 py-3">
                  <span className="flex flex-wrap items-end justify-between gap-4">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{v.vendor_name}</span>
                      <span className="tabular block text-sm text-ink-muted">{describe(v)}</span>
                    </span>
                    <span className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-ink-muted">Ship date</span>
                      <DatePicker value={a.ship_date} invalid={!a.ship_date} aria-label={`Ship date for ${v.vendor_name}`} className="w-44"
                                  onChange={(day) => { setPreview(null); setAlloc((current) => ({ ...current, [v.vendor_id]: { ...current[v.vendor_id]!, ship_date: day } })); }} />
                    </span>
                  </span>
                  {/* The two documents generated for this vendor, each in its own card (drafts until Generate PO). */}
                  <span className="grid gap-3 sm:grid-cols-2">
                    <DocCard title="Purchase Order" subtitle="Draft">
                      <Button size="sm" onClick={() => draftPdf(v.vendor_id)} disabled={previewing !== null || !a.ship_date}>
                        <FileIcon size={14} className="text-ink-muted" />{previewing === `po-${v.vendor_id}` ? "Making…" : "Preview"}
                      </Button>
                      <Button size="sm" onClick={() => draftPdf(v.vendor_id, true)} disabled={previewing !== null || !a.ship_date}>
                        <DownloadIcon size={14} className="text-ink-muted" />Download
                      </Button>
                    </DocCard>
                    <DocCard title="Intimation Letter" subtitle="Draft">
                      <Button size="sm" onClick={() => draftPdf(v.vendor_id, false, "letter")} disabled={previewing !== null}>
                        <FileIcon size={14} className="text-ink-muted" />{previewing === `letter-${v.vendor_id}` ? "Making…" : "Preview"}
                      </Button>
                      <Button size="sm" onClick={() => draftPdf(v.vendor_id, true, "letter")} disabled={previewing !== null}>
                        <DownloadIcon size={14} className="text-ink-muted" />Download
                      </Button>
                    </DocCard>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-ink-muted">
            Order ship date: <span className="font-medium text-ink">{formatDate(state.order.ship_date)}</span>. Each vendor&apos;s ship date is set
            {` ${VENDOR_LEAD_DAYS}`} days earlier by default; change it if needed. The purchase order shows it as Required By.
          </p>
          {!datesSet && <p className="text-sm text-dec">Choose a ship date for each vendor.</p>}
          <p className="text-sm text-ink-muted">
            Generating saves each vendor&apos;s PO and Intimation Letter as PDFs. Tick &quot;Order placed&quot; once you have sent them to the vendor. After
            generating, the allocation and dates are locked.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setConfirming(false); }} disabled={busy}>Back</Button>
          <Button size="sm" variant="primary" onClick={place} disabled={busy || !datesSet}>{busy ? "Generating…" : "Generate PO"}</Button>
        </div>
        {preview && (
          <PdfViewer url={preview.url} onClose={() => setPreview(null)}
                     title={`${preview.kind === "letter" ? "Intimation Letter" : "Purchase order"} preview · ${state.vendors.find((v) => v.vendor_id === preview.vendorId)?.vendor_name ?? ""} (draft, not saved)`} />
        )}
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
            {state.placements.length > 0 && " still to order"}
            {state.pack_size > 1 && <span className="ml-1 text-xs">({fromMilli(orderQty * state.pack_size)} pcs)</span>}
          </span>
          <span className={`tabular text-xs font-semibold ${remaining === 0 ? "text-inc" : remaining > 0 ? "text-age-yellow-ink" : "text-dec"}`}>
            {remaining === 0 ? "Fully allocated" : remaining > 0 ? `${fromMilli(remaining)} stays open for a later PO` : `${fromMilli(-remaining)} over the Qty to order`}
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
              }).join(", ")}. This is only a warning: it does not stop the PO.
            </span>
          </p>
        )}
        {invalid.length > 0 && <p className="text-xs text-dec">Enter a quantity greater than 0 (up to 3 decimals) for each selected vendor.</p>}
        <div className="flex justify-end pt-1">
          <Button variant="primary" size="sm" disabled={!ready} onClick={() => { setError(null); setConfirming(true); }}>
            Generate PO
          </Button>
        </div>
      </div>

    </div>
  );
}

// One generated PO (placement): its vendor orders, each with the PO and Intimation Letter PDFs and the "Order placed"
// tick.
function PlacedOrders({ state, placement }: { state: VendorOrderState; placement: VendorOrderPlacementInfo }) {
  const warnings = state.warnings.filter((w) => placement.vendor_orders.some((vo) => vo.id === w.vendor_order_id));
  const [viewing, setViewing] = useState<{ id: number; number: string; kind: DraftKind } | null>(null);
  const fileButton = "inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-medium text-ink hover:border-neutral-400 hover:bg-subtle";

  return (
    <div>
      <ul className="divide-y divide-neutral-100">
        {placement.vendor_orders.map((vo) => (
          <li key={vo.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-5 py-3 text-sm">
            <span className="min-w-0">
              <span className="block font-semibold text-ink">{vo.number}</span>
              <span className="block truncate text-xs text-ink-muted">
                {vo.vendor_name}{vo.ship_date ? ` · ship ${formatDate(vo.ship_date)}` : ""}
              </span>
            </span>
            <span className="tabular font-semibold text-ink">{formatQty(vo.qty)} {vo.unit === "pcs" || state.pack_size <= 1 ? "pcs" : "sets"}</span>
            {/* The saved PO and Intimation Letter, each in its own card, and the admin's "Order placed" tick once they
                were sent to the vendor. */}
            <span className="col-span-2 grid gap-3 sm:grid-cols-2">
              <DocCard title="Purchase Order" subtitle={vo.number}>
                <button type="button" onClick={() => setViewing({ id: vo.id, number: vo.number, kind: "po" })} className={fileButton}>
                  <FileIcon size={13} className="text-ink-muted" />View
                </button>
                <a href={`/api/vendor_orders/${vo.id}/pdf?download=1`} className={fileButton}>
                  <DownloadIcon size={13} className="text-ink-muted" />Download
                </a>
              </DocCard>
              <DocCard title="Intimation Letter" subtitle={`For ${vo.number}`}>
                <button type="button" onClick={() => setViewing({ id: vo.id, number: vo.number, kind: "letter" })} className={fileButton}>
                  <FileIcon size={13} className="text-ink-muted" />View
                </button>
                <a href={`/api/vendor_orders/${vo.id}/letter?download=1`} className={fileButton}>
                  <DownloadIcon size={13} className="text-ink-muted" />Download
                </a>
              </DocCard>
            </span>
            <span className="col-span-2 flex justify-end"><OrderPlacedTick order={vo} /></span>
          </li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-md bg-age-yellow px-3 py-2 text-xs text-age-yellow-ink">
          <AlertIcon size={14} className="mt-px shrink-0" />
          <span>Below the MOQ: {warnings.map((w) => w.message).join(" ")}</span>
        </p>
      )}
      {viewing && (
        <PdfViewer url={`/api/vendor_orders/${viewing.id}/${viewing.kind === "letter" ? "letter" : "pdf"}`}
                   downloadUrl={`/api/vendor_orders/${viewing.id}/${viewing.kind === "letter" ? "letter" : "pdf"}?download=1`}
                   title={`${viewing.kind === "letter" ? "Intimation Letter" : "Purchase order"} ${viewing.number}`} onClose={() => setViewing(null)} />
      )}
      <p className="border-b border-neutral-100 bg-neutral-50 px-5 py-2.5 text-xs text-ink-muted">
        PO generated{placement.placed_by ? ` by ${placement.placed_by}` : ""} on {formatDateTime(placement.placed_at)} · ordered{" "}
        <span className="tabular font-semibold text-ink">{formatQty(placement.ordered_qty)}</span> of {formatQty(placement.order_qty)} · locked, cannot be edited
      </p>
    </div>
  );
}

// "Order placed" tick of one generated PO: an admin ticks it once the PO was sent to the vendor (and can untick it).
function OrderPlacedTick({ order }: { order: VendorOrderInfo }) {
  const notify = useToast();
  const admin = useSession().user?.role === "admin";
  const [current, setCurrent] = useState(order);
  const [saving, setSaving] = useState(false);
  const placed = current.order_placed_at !== null;

  async function toggle() {
    setSaving(true);
    try {
      const res = await api.patch<{ data: VendorOrderInfo }>(`/api/vendor_orders/${order.id}`, { order_placed: !placed });
      setCurrent(res.data);
      notify(placed ? `${order.number}: "Order placed" removed.` : `${order.number} marked as order placed.`);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not save.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className={`ml-auto inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-medium ${
      placed ? "bg-age-green text-age-green-ink" : "text-ink-muted"} ${admin ? "cursor-pointer" : ""}`}
           title={placed ? `Ticked${current.order_placed_by ? ` by ${current.order_placed_by}` : ""} on ${formatDateTime(current.order_placed_at!)}` : undefined}>
      <input type="checkbox" checked={placed} disabled={!admin || saving} onChange={toggle}
             className="h-4 w-4 accent-[var(--color-accent)]" />
      Order placed
      {placed && <span className="font-normal">· {formatDateOnly(current.order_placed_at)}</span>}
    </label>
  );
}

// One document of a vendor order (the purchase order or the Intimation Letter) with its buttons.
function DocCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-2 rounded-lg border border-line bg-white px-3 py-2.5 shadow-card">
      <span className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><FileIcon size={14} className="text-tint-violet-ink" />{title}</span>
        <span className="truncate text-xs text-ink-muted" title={subtitle}>{subtitle}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
    </span>
  );
}
