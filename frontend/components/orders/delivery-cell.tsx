"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "@/lib/api";
import type { DeliveryKind, OrderDeliveryInfo, OrderRow, Role } from "@/lib/types";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { CheckIcon, ChevronDownIcon, TrashIcon, TruckIcon } from "../icons";
import { useToast } from "../toast";
import { useDismiss } from "../use-dismiss";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { DatePicker } from "../ui/date-picker";
import { Input } from "../ui/field";
import { Sheet } from "../ui/sheet";

// The status steps of an order, in route order. SASH India (admin) sets the first two, the Warehouse Manager the
// last two. Dispatch from Faridabad carries the SASH India invoice number.
export const STATUS_STEPS: { kind: DeliveryKind; name: string; title: string; hint: string; role: Role; pill: string }[] = [
  { kind: "received", name: "Received", title: "Received at SASH Faridabad", hint: "The order was received at SASH Faridabad.",
    role: "admin", pill: "bg-amber-600" },
  { kind: "dispatched", name: "Dispatched", title: "Dispatched from SASH Faridabad", hint: "The order left SASH Faridabad.",
    role: "admin", pill: "bg-violet-600" },
  { kind: "inbound", name: "Inbound", title: "Delivered to SASH US", hint: "The shipment was received at SASH US.",
    role: "warehouse_manager", pill: "bg-accent" },
  { kind: "outbound", name: "Outbound", title: "Delivered to Deere", hint: "The shipment was delivered to Deere (fulfilled).",
    role: "warehouse_manager", pill: "bg-inc" },
];
type Step = (typeof STATUS_STEPS)[number];

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

// The furthest status reached by an order, or undefined.
function currentStep(row: OrderRow) {
  return [...STATUS_STEPS].reverse().find((s) => row.deliveries?.[s.kind]);
}

// Status column of the Orders table: the order's current status (a solid pill, readable on any row tint, empty when
// none) and a "Set status" dropdown with the statuses the user's role sets (admin: received / dispatched; Warehouse
// Manager: inbound / outbound). Choosing one opens the Status panel to record it.
export function DeliveryCell({ row, role, onChanged }: { row: OrderRow; role: Role | undefined; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  const [recording, setRecording] = useState<DeliveryKind | null>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  useDismiss(menuRef, menu, () => setMenu(false));
  const current = currentStep(row);
  const done = current && row.deliveries?.[current.kind];
  const mine = STATUS_STEPS.filter((s) => s.role === role);

  return (
    <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {current && done && (
        <span title={`${current.title} on ${formatDate(done.delivered_on)}${done.invoice_number ? ` · Invoice ${done.invoice_number}` : ""}${done.marked_by ? ` · ${done.marked_by}` : ""}`}
              className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold text-white shadow-sm ${current.pill}`}>
          <CheckIcon size={12} strokeWidth={2.5} />
          {current.name}
        </span>
      )}
      {mine.length > 0 && (
        <span ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}
                  className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-neutral-300 bg-white px-2 text-xs font-medium text-ink transition-colors hover:border-neutral-400">
            Set status
            <ChevronDownIcon size={12} className="text-ink-muted" />
          </button>
          {menu && (
            <span role="menu" className="absolute left-0 top-8 z-30 w-60 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-pop">
              {mine.map((s) => {
                const set = !!row.deliveries?.[s.kind];
                return (
                  <button key={s.kind} type="button" role="menuitem" disabled={set}
                          onClick={() => { setMenu(false); setRecording(s.kind); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-subtle disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${s.pill}`} />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {set && <CheckIcon size={13} className="text-inc" />}
                  </button>
                );
              })}
            </span>
          )}
        </span>
      )}
      {/* Rendered on <body>, outside the table row. */}
      {recording && createPortal(
        <div onClick={(e) => e.stopPropagation()}>
          <StatusPanel row={row} role={role} initial={recording} onClose={() => setRecording(null)} onChanged={onChanged} />
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
  const [marks, setMarks] = useState<Partial<Record<DeliveryKind, OrderDeliveryInfo>>>(row.deliveries ?? {});
  const mine = STATUS_STEPS.filter((s) => s.role === role);
  const pending = mine.filter((s) => !marks[s.kind]);
  const [kind, setKind] = useState<DeliveryKind>(initial);
  const [date, setDate] = useState(today);
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = STATUS_STEPS.find((s) => s.kind === kind)!;
  const canRecord = pending.some((s) => s.kind === kind);
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

  const reached = STATUS_STEPS.filter((s) => marks[s.kind]).length;

  return (
    <Sheet open onClose={onClose} title="Order status" icon={<TruckIcon size={18} />}
           description={`${reached} of ${STATUS_STEPS.length} steps recorded`}
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
            <span className="text-lg font-semibold text-ink">{row.part_number}</span>
            <Badge>{row.order_type}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            PO <span className="tabular text-ink">{row.po_number}</span> · Line {row.po_line_number} · Ship {formatDate(row.ship_date)}
            {row.qty !== null && <> · Qty <span className="tabular text-ink">{formatQty(row.qty)}</span></>}
          </p>
        </section>

        {/* Tracker */}
        <section className="rounded-lg border border-line bg-white shadow-card">
          <ol className="divide-y divide-neutral-100">
            {STATUS_STEPS.map((s, i) => {
              const done = marks[s.kind];
              return (
                <li key={s.kind} className="flex items-start gap-3 px-5 py-3">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    done ? `${s.pill} text-white` : "border-2 border-neutral-300 bg-white text-ink-muted"}`}>
                    {done ? <CheckIcon size={14} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{s.title}</p>
                    {done ? (
                      <p className="text-xs text-ink-muted">
                        {formatDate(done.delivered_on)}
                        {done.invoice_number && <> · Invoice <span className="font-medium text-ink">{done.invoice_number}</span></>}
                        {` · ${done.marked_by ?? "—"} · ${formatDateTime(done.created_at)}`}
                        {done.note && <span className="block text-ink">“{done.note}”</span>}
                      </p>
                    ) : (
                      <p className="text-xs text-ink-faint">Pending · set by {s.role === "admin" ? "SASH India (Admin)" : "the Warehouse Manager"}</p>
                    )}
                  </div>
                  {done && role === "admin" && (
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
                  const active = kind === s.kind && !done;
                  return (
                    <button key={s.kind} type="button" role="radio" aria-checked={active} disabled={done} onClick={() => setKind(s.kind)}
                            className={`rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              active ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line hover:border-neutral-300"}`}>
                      <span className="block text-sm font-semibold text-ink">{s.name}{done ? " ✓" : ""}</span>
                      <span className="block text-xs text-ink-muted">{s.title}</span>
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
      </div>
    </Sheet>
  );
}
