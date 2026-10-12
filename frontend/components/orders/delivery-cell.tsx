"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "@/lib/api";
import type { DeliveryKind, OrderRow } from "@/lib/types";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import { CheckIcon, PencilIcon, TruckIcon } from "../icons";
import { useToast } from "../toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { DatePicker } from "../ui/date-picker";
import { Input } from "../ui/field";
import { Sheet } from "../ui/sheet";

const KINDS: { kind: DeliveryKind; name: string; title: string; hint: string }[] = [
  { kind: "inbound", name: "Inbound", title: "Delivered to SASH US", hint: "The shipment was received at SASH US." },
  { kind: "outbound", name: "Outbound", title: "Delivered to Deere", hint: "The shipment was delivered to Deere." },
];

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

// Action column of the Orders table: a tag per marked delivery and, for the Warehouse Manager (`canMark`), an
// edit icon that opens the Delivery panel. Admins only see the tags (they remove a wrong mark in the order details).
export function DeliveryCell({ row, canMark, onChanged }: { row: OrderRow; canMark: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {KINDS.map((k) => {
        const done = row.deliveries?.[k.kind];
        return done ? (
          <span key={k.kind} title={`${k.title} on ${formatDate(done.delivered_on)}${done.marked_by ? ` · ${done.marked_by}` : ""}`}>
            <Badge tone="up">{k.name} ✓</Badge>
          </span>
        ) : null;
      })}
      {canMark && (
        <Button size="sm" onClick={() => setOpen(true)} aria-label={`Delivery for PO ${row.po_number}`} title="Inbound / Outbound" className="w-8 px-0!">
          <PencilIcon size={14} className="text-ink-muted" />
        </Button>
      )}
      {/* Rendered on <body>: the pinned (sticky) cell would otherwise keep the panel below the rows after it. */}
      {open && createPortal(
        <div onClick={(e) => e.stopPropagation()}>
          <DeliveryPanel row={row} onClose={() => setOpen(false)} onChanged={onChanged} />
        </div>,
        document.body,
      )}
    </span>
  );
}

// Delivery panel: the order at the top, a two-step tracker (Inbound → Outbound) with each step's status, and —
// one form to record the next delivery (type, date, optional note). Recording emails the India team (admins).
// Opened only by the Warehouse Manager.
function DeliveryPanel({ row, onClose, onChanged }: { row: OrderRow; onClose: () => void; onChanged: () => void }) {
  const notify = useToast();
  const [marks, setMarks] = useState(row.deliveries ?? {});
  const pendingKinds = KINDS.filter((k) => !marks[k.kind]);
  const [kind, setKind] = useState<DeliveryKind>(pendingKinds[0]?.kind ?? "inbound");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = KINDS.find((k) => k.kind === kind)!;
  const canRecord = pendingKinds.length > 0 && !marks[kind];

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ data: NonNullable<OrderRow["deliveries"]>[DeliveryKind] }>(
        `/api/orders/${row.id}/deliveries${row.manual ? "?manual=1" : ""}`, { kind, delivered_on: date, note },
      );
      const next = { ...marks, [kind]: res.data };
      setMarks(next);
      setNote("");
      setKind(KINDS.find((k) => !next[k.kind])?.kind ?? kind);
      notify(`PO ${row.po_number}: ${selected.name.toLowerCase()} recorded. The India team has been notified.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the delivery.");
    } finally {
      setBusy(false);
    }
  }

  const doneCount = KINDS.filter((k) => marks[k.kind]).length;

  return (
    <Sheet open onClose={onClose} title="Delivery" icon={<TruckIcon size={18} />}
           description={`${doneCount} of ${KINDS.length} deliveries recorded`}
           footer={
             <>
               <Button variant="ghost" onClick={onClose} disabled={busy}>{canRecord ? "Cancel" : "Close"}</Button>
               {canRecord && (
                 <Button variant="primary" onClick={record} disabled={busy || !date}>{busy ? "Saving…" : `Record ${selected.name.toLowerCase()}`}</Button>
               )}
             </>
           }>
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}

        {/* Order */}
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
        <section className="rounded-lg border border-line bg-white px-5 py-5 shadow-card">
          <ol className="grid grid-cols-2">
            {KINDS.map((k, i) => {
              const done = marks[k.kind];
              return (
                <li key={k.kind} className="relative">
                  {i === 0 && <span aria-hidden className={`absolute left-4 right-0 top-4 h-0.5 ${done ? "bg-inc" : "bg-neutral-200"}`} />}
                  {i > 0 && <span aria-hidden className={`absolute left-0 right-[calc(100%-1rem)] top-4 h-0.5 ${marks[KINDS[0]!.kind] ? "bg-inc" : "bg-neutral-200"}`} />}
                  <span className={`relative z-[1] flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ring-4 ring-white ${
                    done ? "bg-inc text-white" : "border-2 border-neutral-300 bg-white text-ink-muted"}`}>
                    {done ? <CheckIcon size={16} /> : i + 1}
                  </span>
                  <p className="mt-3 text-sm font-semibold text-ink">{k.name}</p>
                  <p className="text-xs text-ink-muted">{k.title}</p>
                  {done ? (
                    <div className="mt-2 pr-4 text-xs">
                      <p className="font-medium text-inc">Delivered {formatDate(done.delivered_on)}</p>
                      <p className="text-ink-muted">by {done.marked_by ?? "—"} · {formatDateTime(done.created_at)}</p>
                      {done.note && <p className="mt-1 line-clamp-2 text-ink" title={done.note}>“{done.note}”</p>}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs font-medium text-ink-muted">Pending</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* Record a delivery (Warehouse Manager) */}
        {pendingKinds.length > 0 && (
          <section className="rounded-lg border border-line bg-white shadow-card">
            <h3 className="border-b border-neutral-100 px-5 py-3 text-sm font-semibold text-ink">Record delivery</h3>
            <div className="space-y-4 px-5 py-4">
              <div role="radiogroup" aria-label="Delivery" className="grid grid-cols-2 gap-2">
                {KINDS.map((k) => {
                  const done = !!marks[k.kind];
                  const active = kind === k.kind && !done;
                  return (
                    <button key={k.kind} type="button" role="radio" aria-checked={active} disabled={done} onClick={() => setKind(k.kind)}
                            className={`rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              active ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line hover:border-neutral-300"}`}>
                      <span className="block text-sm font-semibold text-ink">{k.name}{done ? " ✓" : ""}</span>
                      <span className="block text-xs text-ink-muted">{k.title}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
                <div>
                  <label htmlFor="delivery-date" className="mb-1.5 block text-sm font-medium text-ink">Delivered on</label>
                  <DatePicker id="delivery-date" value={date} max={today()} onChange={setDate} className="w-full" />
                </div>
                <div>
                  <label htmlFor="delivery-note" className="mb-1.5 block text-sm font-medium text-ink">
                    Note <span className="font-normal text-ink-muted">(optional)</span>
                  </label>
                  <Input id="delivery-note" value={note} maxLength={500} className="w-full"
                         placeholder="e.g. 2 pallets received at dock 3" onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-ink-muted">{selected.hint} The India team is emailed when you record it.</p>
            </div>
          </section>
        )}

        {doneCount === KINDS.length && (
          <p className="rounded-lg bg-age-green px-4 py-3 text-sm font-medium text-inc">Both deliveries are recorded for this order.</p>
        )}
      </div>
    </Sheet>
  );
}
