"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "@/lib/api";
import type { DeliveryKind, InvoiceKind, OrderDeliveryInfo, OrderHistory, OrderRow, OrderStatus, Role } from "@/lib/types";
import { formatDate, formatDateTime, formatQty, todayIst } from "@/lib/format";
import { BoxIcon, CheckIcon, HistoryIcon, MapPinIcon, TrashIcon, TruckIcon } from "../icons";
import { useToast } from "../toast";
import { useApi } from "../use-api";
import { useDismiss } from "../use-dismiss";
import { InvoiceMoves } from "./order-details-modal";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { DatePicker } from "../ui/date-picker";
import { Input } from "../ui/field";
import { RelatedLink } from "./related-popover";
import { Sheet } from "../ui/sheet";

// The status steps of an order, in route order. SASH India (admin) sets the first two, the Warehouse Manager the
// last two. Dispatch from Faridabad carries the SASH India invoice number; an order on uploaded SASH India invoices
// is dispatched by them (Dispatch while part of its Qty is sent), and delivered to Deere by SASH Inc invoices.
export const STATUS_STEPS: { kind: DeliveryKind; name: string; title: string; hint: string; role: Role; pill: string }[] = [
  { kind: "received", name: "Received", title: "Received", hint: "The order was received at SASH Faridabad.",
    role: "admin", pill: "bg-amber-600" },
  { kind: "dispatched", name: "Dispatched", title: "Dispatched", hint: "The order left SASH Faridabad.",
    role: "admin", pill: "bg-violet-600" },
  { kind: "inbound", name: "Inbound", title: "Inbound", hint: "The shipment was received at SASH US.",
    role: "warehouse_manager", pill: "bg-accent" },
  { kind: "outbound", name: "Outbound", title: "Outbound", hint: "The shipment was delivered to Deere (fulfilled).",
    role: "warehouse_manager", pill: "bg-inc" },
];
type Step = (typeof STATUS_STEPS)[number];
// How far each status goes, and the status each step stands for: an order whose status is at or past a step has
// reached it (Received is reached once the order is on its way, even without a Received mark). The dispatch step is
// reached (Dispatched) by a Dispatched mark (dispatched orders list or by hand) or SASH India invoices for all of the Qty;
// part of it on invoices leaves it at Dispatch. Likewise SASH Inc invoices for part of the Qty: Partial outbound (Inbound
// reached), for all of it: Outbound.
const STATUS_RANK: Record<OrderStatus, number> = { none: 0, received: 1, dispatch: 2, dispatched: 3, inbound: 4, delivery: 5, outbound: 6 };
const STEP_RANK: Record<DeliveryKind, number> = { received: 1, dispatched: 3, inbound: 4, outbound: 6 };
const reachedStep = (row: OrderRow, s: Step) => STATUS_RANK[row.status ?? "none"] >= STEP_RANK[s.kind];
// A step's name as shown: the dispatch step reads "Dispatch" until the order is Dispatched, then "Dispatched".
const stepName = (s: Step, reached: boolean) => (s.kind === "dispatched" && !reached ? "Dispatch" : s.title);

// Soft status pills (tinted background, border, icon), like the CRM status chips.
const PILL: Record<OrderStatus, { label: string; cls: string; Icon: typeof CheckIcon }> = {
  none: { label: "No status", cls: "border-neutral-300 bg-white text-ink-muted", Icon: HistoryIcon },
  received: { label: "Received", cls: "border-amber-300 bg-amber-50 text-amber-800", Icon: BoxIcon },
  dispatch: { label: "Dispatch", cls: "border-dashed border-violet-300 bg-violet-50/60 text-violet-800", Icon: TruckIcon },
  dispatched: { label: "Dispatched", cls: "border-violet-300 bg-violet-50 text-violet-800", Icon: TruckIcon },
  inbound: { label: "Inbound", cls: "border-blue-300 bg-blue-50 text-blue-800", Icon: MapPinIcon },
  delivery: { label: "Partial outbound", cls: "border-dashed border-green-300 bg-green-50/60 text-green-800", Icon: CheckIcon },
  outbound: { label: "Outbound", cls: "border-green-300 bg-green-50 text-green-800", Icon: CheckIcon },
};

// The longest label: every pill is as wide as it (an invisible copy under the label), so all pills are one size.
const WIDEST = Object.values(PILL).reduce((a, p) => (p.label.length > a.length ? p.label : a), "");

export function StatusPill({ kind }: { kind: OrderStatus }) {
  const { label, cls, Icon } = PILL[kind];
  return (
    <span className={`inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-sm font-semibold ${cls}`}>
      <Icon size={14} strokeWidth={2.25} />
      <span className="inline-grid text-center">
        <span className="col-start-1 row-start-1">{label}</span>
        <span aria-hidden className="invisible col-start-1 row-start-1">{WIDEST}</span>
      </span>
    </span>
  );
}

const today = () => todayIst(); // YYYY-MM-DD in IST

// The step before this one (statuses go in route order), or undefined for the first.
function previousStep(kind: DeliveryKind) {
  const i = STATUS_STEPS.findIndex((s) => s.kind === kind);
  return i > 0 ? STATUS_STEPS[i - 1] : undefined;
}

// The furthest status mark of an order, or undefined.
function currentStep(row: OrderRow) {
  return [...STATUS_STEPS].reverse().find((s) => row.deliveries?.[s.kind]);
}

// Dispatched on uploaded SASH India invoices (part or all): no Dispatched mark is set by hand then.
const invoiced = (row: OrderRow) => Number(row.shipped_qty ?? 0) > 0;
// A step done without its own mark: the order's status (marks and invoices) is at or past it, e.g. Inbound and Outbound
// once SASH Inc invoices delivered all of its Qty, Received once it is on its way; or SASH India invoices dispatched any
// of it (Dispatch).
const doneByStatus = (row: OrderRow, kind: DeliveryKind) =>
  (kind === "dispatched" && invoiced(row)) || STATUS_RANK[row.status ?? "none"] >= STEP_RANK[kind];

// "192 of 600 on EX/26-27/235 (29 Oct 2026)": the row's Qty on its invoices of one kind.
function invoiceSummary(row: OrderRow, kind: InvoiceKind) {
  const moves = (row.invoice_moves ?? []).filter((m) => m.kind === kind);
  if (moves.length === 0) return null;
  const total = kind === "india" ? row.shipped_qty : row.outbound_qty;
  return `${formatQty(total ?? "0")} of ${formatQty(row.order_qty ?? row.qty ?? "0")} on ${moves.map((m) => `${m.invoice_number} (${formatDate(m.invoice_date)})`).join(", ")}`;
}

// Status column of the Orders table: the order's current status as a pill. Clicking it opens a dropdown with the
// statuses the user's role sets (admin: Received / Dispatched; Warehouse Manager: Inbound / Outbound). Choosing one opens
// the panel on it, where it is recorded (date, note; the SASH India invoice number for Dispatched). "Details & history"
// opens the panel with every step (an admin can remove a wrong status there).
export function DeliveryCell({ row, role, onChanged }: { row: OrderRow; role: Role | undefined; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<DeliveryKind | null>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  // The dropdown opens on <body> (fixed, under the pill) so the table's scroll area does not cut it off.
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  useDismiss(menuRef, menu, () => setMenu(false));
  // A fixed dropdown would drift from its pill when the page or table scrolls, so it closes instead.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [menu]);

  function toggleMenu() {
    if (!menu && menuRef.current) {
      const r = menuRef.current.getBoundingClientRect();
      const height = 44 * 2 + 60;
      const top = r.bottom + 6 + height > window.innerHeight ? Math.max(8, r.top - 6 - height) : r.bottom + 6;
      setMenuAt({ top, left: Math.min(r.left, window.innerWidth - 232) });
    }
    setMenu(!menu);
  }
  const current = currentStep(row);
  const done = current && row.deliveries?.[current.kind];
  const mine = STATUS_STEPS.filter((s) => s.role === role);

  // Choosing a status opens the Status panel on it: it is recorded there with "Record", so one click never sets a status
  // by mistake.
  function choose(step: Step) {
    setMenu(false);
    setPanel(step.kind);
  }

  const pill = <StatusPill kind={row.status ?? current?.kind ?? "none"} />;
  const fromInvoices = [invoiceSummary(row, "india") && `Dispatched ${invoiceSummary(row, "india")}${Number(row.balance_qty ?? 0) > 0 ? ` · Balance ${formatQty(row.balance_qty!)}` : ""}`,
                        invoiceSummary(row, "inc") && `Outbound ${invoiceSummary(row, "inc")}`].filter(Boolean);
  const title = [
    current && done ? `${current.title} on ${formatDate(done.delivered_on)}${done.invoice_number ? ` · Invoice ${done.invoice_number}` : ""}${done.marked_by ? ` · ${done.marked_by}` : ""}` : null,
    ...fromInvoices,
  ].filter(Boolean).join("\n") || "No status yet";

  return (
    <span ref={menuRef} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      {mine.length === 0 ? <span title={title}>{pill}</span> : (
        <button type="button" onClick={toggleMenu} aria-haspopup="menu" aria-expanded={menu} title={title}
                className="rounded-full transition-opacity hover:opacity-80 disabled:opacity-50">
          {pill}
        </button>
      )}
      {menu && menuAt && createPortal(
        <span role="menu" data-floating style={{ top: menuAt.top, left: menuAt.left }} onClick={(e) => e.stopPropagation()}
              className="fixed z-[70] block w-56 overflow-hidden rounded-lg border border-line bg-white py-1.5 shadow-pop">
          {mine.map((s) => {
            const set = !!row.deliveries?.[s.kind] || doneByStatus(row, s.kind);
            const before = previousStep(s.kind);
            const waiting = !set && before && !row.deliveries?.[before.kind] && !doneByStatus(row, before.kind);
            return (
              <button key={s.kind} type="button" role="menuitem" disabled={set || !!waiting} onClick={() => choose(s)}
                      title={waiting ? `Waiting for ${before!.name}` : undefined}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-tint-violet/60 disabled:cursor-default disabled:hover:bg-transparent">
                <span className={set || waiting ? "opacity-50" : ""}><StatusPill kind={s.kind} /></span>
                {set && <CheckIcon size={14} className="text-inc" />}
                {waiting && <span className="text-xs text-ink-faint">Waiting for {before!.name}</span>}
              </button>
            );
          })}
          <span className="my-1 block border-t border-neutral-100" />
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setPanel(mine.find((s) => !row.deliveries?.[s.kind] && !(s.kind === "dispatched" && invoiced(row)))?.kind ?? mine[0]!.kind); }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-ink-muted hover:bg-subtle hover:text-ink">
            Details &amp; history
          </button>
        </span>,
        document.body,
      )}
      {/* Rendered on <body>, outside the table row. */}
      {panel && createPortal(
        <div onClick={(e) => e.stopPropagation()}>
          <StatusPanel row={row} role={role} initial={panel} onClose={() => setPanel(null)} onChanged={onChanged} />
        </div>,
        document.body,
      )}
    </span>
  );
}

// Status panel: the order, the four-step tracker (with each step's date, invoice number and who set it; an admin
// can remove a wrong mark), and the form to record a status the user's role sets — date, the SASH India invoice
// number for dispatch, and an optional note.
function StatusPanel({ row, role, initial, onClose, onChanged }: {
  row: OrderRow; role: Role | undefined; initial: DeliveryKind; onClose: () => void; onChanged: () => void;
}) {
  const notify = useToast();
  // The order's invoices one by one (from its Order details), listed under the steps.
  const history = useApi<OrderHistory>(`/api/orders/${row.id}/history`, { manual: row.manual ? 1 : undefined });
  const [marks, setMarks] = useState<Partial<Record<DeliveryKind, OrderDeliveryInfo>>>(row.deliveries ?? {});
  const mine = STATUS_STEPS.filter((s) => s.role === role);
  // A step reached by the uploaded invoices (Dispatched by SASH India invoices: no mark by hand then).
  const byInvoice = (kind: DeliveryKind) => doneByStatus(row, kind);
  const ready = (s: Step) => { const before = previousStep(s.kind); return !before || !!marks[before.kind] || byInvoice(before.kind); };
  // Steps still to record: not marked, not reached by the order's status (e.g. Received once it is on its way).
  const pending = mine.filter((s) => !marks[s.kind] && !byInvoice(s.kind) && !reachedStep(row, s));
  const [kind, setKind] = useState<DeliveryKind>(initial);
  const [date, setDate] = useState(today);
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = STATUS_STEPS.find((s) => s.kind === kind)!;
  const canRecord = pending.some((s) => s.kind === kind) && ready(selected);
  const lastDone = [...STATUS_STEPS].reverse().find((s) => marks[s.kind])?.kind;
  const needsInvoice = kind === "dispatched";

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ data: OrderDeliveryInfo }>(`/api/orders/${row.id}/deliveries${row.manual ? "?manual=1" : ""}`, {
        kind, delivered_on: date, note, invoice_number: needsInvoice ? invoice.trim() : undefined,
      });
      const next = { ...marks, [kind]: res.data };
      setMarks(next);
      setNote("");
      setInvoice("");
      setKind(mine.find((s) => !next[s.kind])?.kind ?? kind);
      notify(`PO ${row.po_number}: "${selected.title}" recorded.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the status.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(step: Step, id: number) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/order_deliveries/${id}`);
      setMarks((m) => ({ ...m, [step.kind]: undefined }));
      notify(`"${step.title}" removed.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the status.");
    } finally {
      setBusy(false);
    }
  }

  const doneSteps = STATUS_STEPS.filter((s) => reachedStep(row, s)).length;
  const invoices: Partial<Record<DeliveryKind, string | null>> = { dispatched: invoiceSummary(row, "india"), outbound: invoiceSummary(row, "inc") };

  return (
    <Sheet open wide onClose={onClose} title="Order status" icon={<TruckIcon size={18} />}
           description={`${doneSteps} of ${STATUS_STEPS.length} steps done`}
           footer={
             <>
               <Button variant="ghost" onClick={onClose} disabled={busy}>{canRecord ? "Cancel" : "Close"}</Button>
               {canRecord && (
                 <Button variant="primary" onClick={record} disabled={busy || !date || (needsInvoice && !invoice.trim())}>
                   {busy ? "Saving…" : `Record "${selected.name}"`}
                 </Button>
               )}
             </>
           }>
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}

        <section className="rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-ink"><RelatedLink kind="part" value={row.part_number} /></span>
            <Badge>{row.order_type}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            PO <span className="tabular text-ink"><RelatedLink kind="po" value={row.po_number} /></span> · Line {row.po_line_number} · Ship {formatDate(row.ship_date)}
            {row.qty !== null && <> · Qty <span className="tabular text-ink">{formatQty(row.qty)}</span></>}
          </p>
        </section>

        {/* Tracker */}
        <section className="rounded-lg border border-line bg-white shadow-card">
          <ol className="divide-y divide-neutral-100">
            {STATUS_STEPS.map((s, i) => {
              const done = marks[s.kind];
              const fromInvoices = invoices[s.kind];
              const reached = reachedStep(row, s);
              return (
                <li key={s.kind} className="flex items-start gap-3 px-5 py-3">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    reached ? `${s.pill} text-white` : done ? "border-2 border-violet-400 bg-violet-50 text-violet-700" : "border-2 border-neutral-300 bg-white text-ink-muted"}`}>
                    {reached ? <CheckIcon size={14} /> : done ? <TruckIcon size={13} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{stepName(s, reached)}</p>
                    {done ? (
                      <p className="text-xs text-ink-muted">
                        {formatDate(done.delivered_on)}
                        {done.invoice_number && <> · Invoice <span className="font-medium text-ink">{done.invoice_number}</span></>}
                        {` · ${done.marked_by ?? "—"} · ${formatDateTime(done.created_at)}`}
                        {done.note && <span className="block text-ink">“{done.note}”</span>}
                      </p>
                    ) : reached && !fromInvoices ? (
                      <p className="text-xs text-ink-muted">Done · the order is further along</p>
                    ) : !fromInvoices ? (
                      <p className="text-xs text-ink-faint">Pending · set by {s.role === "admin" ? "SASH India (Admin)" : "the Warehouse Manager"}</p>
                    ) : null}
                    {/* Qty of this row on the uploaded invoices (every invoice in Order details). */}
                    {fromInvoices && (
                      <p className="text-xs text-ink-muted">
                        {s.kind === "dispatched" ? "SASH India invoices" : "SASH Inc invoices"}: <span className="font-medium text-ink">{fromInvoices}</span>
                        {s.kind === "dispatched" && Number(row.balance_qty ?? 0) > 0 && <> · Balance <span className="tabular font-medium text-ink">{formatQty(row.balance_qty!)}</span></>}
                      </p>
                    )}
                  </div>
                  {done && role === "admin" && s.kind === lastDone && (
                    <button type="button" disabled={busy} onClick={() => remove(s, done.id)} title="Remove this status"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-ink-muted hover:bg-subtle hover:text-dec disabled:opacity-50">
                      <TrashIcon size={12} />Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* Record a status (the user's role) */}
        {pending.length > 0 && (
          <section className="rounded-lg border border-line bg-white shadow-card">
            <h3 className="border-b border-neutral-100 px-5 py-3 text-sm font-semibold text-ink">Record status</h3>
            <div className="space-y-4 px-5 py-4">
              <div role="radiogroup" aria-label="Status" className="grid grid-cols-2 gap-2">
                {mine.map((s) => {
                  const done = !!marks[s.kind];
                  const waiting = !done && !ready(s);
                  const active = kind === s.kind && !done;
                  return (
                    <button key={s.kind} type="button" role="radio" aria-checked={active} disabled={done || waiting} onClick={() => setKind(s.kind)}
                            className={`rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              active ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line hover:border-neutral-300"}`}>
                      <span className="block text-sm font-semibold text-ink">{stepName(s, reachedStep(row, s))}{done ? " ✓" : ""}</span>
                      <span className="block text-xs text-ink-muted">{waiting ? `Waiting for ${previousStep(s.kind)!.name}` : s.hint}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
                <div>
                  <label htmlFor="status-date" className="mb-1.5 block text-sm font-medium text-ink">Date</label>
                  <DatePicker id="status-date" value={date} max={today()} onChange={setDate} className="w-full" />
                </div>
                {needsInvoice && (
                  <div>
                    <label htmlFor="status-invoice" className="mb-1.5 block text-sm font-medium text-ink">SASH India Invoice Number</label>
                    <Input id="status-invoice" value={invoice} maxLength={64} invalid={!invoice.trim()} className="w-full"
                           placeholder="e.g. SAI/2026-27/0412" onChange={(e) => setInvoice(e.target.value)} />
                  </div>
                )}
                <div className={needsInvoice ? "sm:col-span-2" : ""}>
                  <label htmlFor="status-note" className="mb-1.5 block text-sm font-medium text-ink">
                    Note <span className="font-normal text-ink-muted">(optional)</span>
                  </label>
                  <Input id="status-note" value={note} maxLength={500} className="w-full" placeholder="e.g. 2 pallets"
                         onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                {selected.hint}{role === "warehouse_manager" ? " The India team is emailed when you record it." : ""}
              </p>
            </div>
          </section>
        )}

        {/* Last: every dispatch and outbound of the order on uploaded invoices (as in Order details). */}
        {history.data && <InvoiceMoves row={row} moves={history.data.invoices ?? []} onChanged={() => { history.reload(); onChanged(); }} />}
      </div>
    </Sheet>
  );
}
