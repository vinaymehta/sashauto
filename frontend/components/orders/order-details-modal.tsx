"use client";

import { can } from "@/lib/permissions";
import { createContext, Fragment, useContext, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { OrderHistory, OrderRow, ScheduleGroup } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { AGE_TITLE, ageGroup } from "../age";
import { BoxIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, MapPinIcon, PlusIcon } from "../icons";
import { useSession } from "../session";
import { useToast } from "../toast";
import { Button } from "../ui/button";

type Source = OrderRow["source_data"];

// One Excel cell of a row, trimmed; null when blank.
function src(data: Source, key: string) {
  const value = data?.[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

const price = (value: string | null) => (value === null || Number.isNaN(Number(value)) ? value : Number(value).toFixed(2));

// The part's MOQ (sets) for the Schedule's ✓ / ✗ next to each Quantity.
const MoqContext = createContext<string | null>(null);

// Opens the order details panel for a row (provided by the Orders page).
export const OpenOrderContext = createContext<(row: OrderRow) => void>(() => undefined);

// PO Number in the Orders table. Clicking it opens the order details panel (supplier-portal layout).
export function OrderDetailsLink({ row }: { row: OrderRow }) {
  const open = useContext(OpenOrderContext);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open(row); }}
            className="font-medium text-ink underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
      {row.po_number}
    </button>
  );
}

const AGE_DOT = { green: "bg-age-green-ink", yellow: "bg-age-yellow-ink", red: "bg-age-red-ink" } as const;
const AGE_DOT_TITLE = AGE_TITLE;

const COLUMNS: { label: string; value: (r: OrderRow, description: string | null) => ReactNode; align?: "right" | "center" }[] = [
  { label: "Deere Part Number", value: (r) => r.part_number },
  { label: "Order Type", value: (r) => r.order_type },
  { label: "Due Date", value: (r) => (r.due_date ? formatDate(r.due_date) : null) },
  { label: "Firm Date", value: (r) => (r.firm_date ? formatDate(r.firm_date) : null) },
  { label: "Ship Date", value: (r) => formatDate(r.ship_date) },
  { label: "Quantity", value: (r) => (r.qty === null ? null : formatQty(r.qty)), align: "right" },
  // ✓ / ✗: the row's Qty (a combined row's total) reaches the part's MOQ or not (MoqMark).
  { label: "MOQ", value: () => null, align: "center" },
  { label: "UOM", value: () => null },
  { label: "Price", value: (r) => price(src(r.source_data, "Unit Price")), align: "right" },
  { label: "Unit of Price", value: () => null },
  { label: "Currency", value: () => null },
  { label: "Description", value: (_, description) => description },
  { label: "Supplier Part Number", value: (r) => r.supplier_part_number },
  { label: "Last Receipt Date", value: (r) => (r.last_receipt_date ? formatDate(r.last_receipt_date) : null) },
  { label: "Last Receipt Quantity", value: (r) => (r.last_receipt_qty === null ? null : formatQty(r.last_receipt_qty)), align: "right" },
  { label: "Shipment ID", value: () => null },
  { label: "Packing List Number", value: (r) => r.last_packing_list_number },
  { label: "Engineering Change Level", value: (r) => src(r.source_data, "EC Level") },
  { label: "International Harmonized Commodity Code", value: () => null },
  { label: "Manufacturer", value: () => null },
  { label: "Container Code", value: () => null },
  { label: "Qty per Container", value: () => null },
  { label: "Dock Code", value: (r) => r.dock_number },
];

// Order details content, in the app's card and table style: the order's facts (only fields the file has), its
// Ship To address, and every row of the same PO Number + Part Number + Type (`rows`, the clicked row highlighted).
// Combined orders (`combined`) show in the Schedule as one row that opens to list its orders; `onChanged` is called
// after an admin adds orders to one or takes them out. `group` gives the part's MOQ (header, and ✓ / ✗ per Quantity).
export function OrderDetailsBody({ row, rows, description, combined = [], onChanged, group }: {
  row: OrderRow; rows: OrderRow[]; description: string | null; combined?: ScheduleGroup[]; onChanged?: () => void;
  group?: OrderHistory["group"];
}) {
  const s = row.source_data;
  const cityLine = [src(s, "Ship to City"), [src(s, "Ship to Region"), src(s, "Ship to PostalCode")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [src(s, "Ship to Name"), src(s, "Ship To Address"), cityLine || null].filter(Boolean);
  const facts = ([
    ["PO Line", row.po_line_number],
    ["Supplier Part Number", row.supplier_part_number],
    ["Unit", row.unit?.trim() || null],
    ["MOQ", group?.moq ? `${formatQty(group.moq)}${group.pack_size > 1 ? ` sets (${formatQty(group.moq_pcs ?? String(Number(group.moq) * group.pack_size))} pcs)` : ""}` : null],
  ] as [string, string | null][]).filter(([, value]) => value);
  // Every column of the supplier-portal order view, also when the file has no value for it.
  const columns = COLUMNS;
  const today = new Date();

  return (
    <div className="space-y-4">
      {/* Order: part details, with Ship To below them in the same card */}
      <section className="overflow-hidden rounded-lg border border-line bg-gradient-to-br from-tint-violet/70 via-white to-white shadow-card">
        <div className="flex min-w-0 items-start gap-4 px-5 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-tint-violet-ink shadow-card ring-1 ring-tint-violet-ink/15">
            <BoxIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight text-ink">{row.part_number}</h3>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-tint-violet-ink ring-1 ring-tint-violet-ink/20">{row.order_type}</span>
              {row.below_moq && (
                <span className="rounded-full bg-age-yellow px-2.5 py-0.5 text-xs font-semibold text-age-yellow-ink ring-1 ring-age-yellow-ink/25">
                  Below MOQ{row.moq ? ` · ${row.moq_balance ? `to order ${formatQty(row.moq_balance)} of ` : ""}MOQ ${formatQty(row.moq)}` : ""}
                </span>
              )}
            </div>
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line">PO <span className="tabular font-semibold text-ink">{row.po_number}</span></span>
              {facts.map(([label, v]) => (
                <span key={label} className="max-w-full truncate rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line" title={v ?? undefined}>
                  {label} <span className="font-semibold text-ink">{v}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/70 bg-white/60 px-5 py-3 text-sm">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            <MapPinIcon size={13} className="text-tint-violet-ink" />
            Ship To
          </span>
          {address.length ? (
            <address className="min-w-0 not-italic text-ink">
              <span className="font-semibold">{address[0]}</span>
              {address.length > 1 && <span className="text-ink-muted">, {address.slice(1).join(", ")}</span>}
            </address>
          ) : (
            <span className="text-ink-faint">Not in the file</span>
          )}
        </div>
      </section>

      {/* Schedule, full width */}
      <section className="min-w-0 overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Schedule</h3>
          <span className="text-xs text-ink-muted">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th aria-label="Age" className="h-10 w-8 border-b border-neutral-200 bg-neutral-50 pl-5" />
                {columns.map((c) => (
                  <th key={c.label} className={`h-10 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-3 text-xs font-bold uppercase tracking-wider text-neutral-800 last:pr-5 ${
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <MoqContext.Provider value={group?.moq ?? null}>
              <ScheduleRows row={row} rows={rows} description={description} groups={combined} today={today} onChanged={onChanged} />
            </MoqContext.Provider>
          </table>
        </div>
      </section>
    </div>
  );
}

// Schedule rows. The orders of a combined order are listed under one tinted row (combined Qty, first to last Ship
// Date) that opens and closes on click; all start closed.
function ScheduleRows({ row, rows, description, groups, today, onChanged }: {
  row: OrderRow; rows: OrderRow[]; description: string | null; groups: ScheduleGroup[]; today: Date; onChanged?: () => void;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const groupOf = new Map(groups.flatMap((g) => g.member_ids.map((id) => [id, g] as const)));
  const takenOut = new Set(groups.flatMap((g) => g.removed_ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const toggle = (anchorId: number) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(anchorId)) next.delete(anchorId);
    else next.add(anchorId);
    return next;
  });

  return (
    <tbody>
      {rows.map((r) => {
        const g = groupOf.get(r.id);
        if (!g) return <ScheduleTr key={r.id} r={r} current={r.id === row.id} description={description} today={today} takenOut={takenOut.has(r.id)} />;
        if (r.id !== g.anchor_id) return null; // listed under its combined order
        const members = g.member_ids.map((id) => byId.get(id)).filter((m): m is OrderRow => m !== undefined);
        const expanded = open.has(g.anchor_id);
        return (
          <Fragment key={r.id}>
            <CombinedTr group={g} members={members} expanded={expanded} description={description} onToggle={() => toggle(g.anchor_id)} />
            {expanded && members.map((m) => (
              <ScheduleTr key={m.id} r={m} current={m.id === row.id} description={description} today={today} member
                          manual={g.manual_ids.includes(m.id)} removable={!g.placed && m.id !== g.anchor_id} anchorId={g.anchor_id}
                          onChanged={onChanged} />
            ))}
            {expanded && <CombinedActions group={g} rows={byId} onChanged={onChanged} />}
          </Fragment>
        );
      })}
    </tbody>
  );
}

// One order of the Schedule. `member`: listed under a combined order; `manual`: added to it by an admin. An admin
// can take any order but the first out of a combined order (`removable`, before the PO is generated); `takenOut`:
// an order taken out of one.
function ScheduleTr({ r, current, description, today, member = false, manual = false, removable = false, takenOut = false, anchorId, onChanged }: {
  r: OrderRow; current: boolean; description: string | null; today: Date; member?: boolean; manual?: boolean;
  removable?: boolean; takenOut?: boolean; anchorId?: number; onChanged?: () => void;
}) {
  const notify = useToast();
  const admin = can(useSession().user, "orders", "edit"); // Orders edit permission
  const [busy, setBusy] = useState(false);
  const age = r.qty === null ? null : ageGroup(r.firm_date, today); // as the Firm Date column

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/api/orders/${anchorId}/merges/${r.id}`);
      notify(`PO Line ${r.po_line_number} (ship ${formatDate(r.ship_date)}) taken out of the combined order.`);
      onChanged?.();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not take the order out.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={current ? "bg-accent/5" : member ? "bg-tint-violet/25" : "hover:bg-neutral-50/60"} aria-current={current || undefined}>
      <td className={`h-11 border-b border-neutral-100 pl-5 ${member ? "shadow-[inset_3px_0_0_var(--color-tint-violet-ink)]" : ""}`}>
        <span title={age ? AGE_DOT_TITLE[age] : "Under 30 days since Firm Date, or no Firm Date"}
              className={`block h-2.5 w-2.5 rounded-full ${age ? AGE_DOT[age] : "bg-neutral-200"}`} />
      </td>
      {COLUMNS.map((c, i) => (
        <td key={c.label} className={`h-11 whitespace-nowrap border-b border-neutral-100 px-3 text-ink last:pr-5 ${
          c.align === "right" ? "tabular text-right" : c.align === "center" ? "text-center" : ""} ${current ? "font-semibold" : ""}`}>
          {i === 0 ? (
            <span className="inline-flex items-center gap-1.5">
              {c.value(r, description)}
              {manual && <span className="rounded border border-tint-violet-ink/25 bg-white px-1.5 py-px text-xs font-medium text-tint-violet-ink">Added manually</span>}
              {takenOut && <span className="rounded border border-line bg-white px-1.5 py-px text-xs font-medium text-ink-muted">Taken out</span>}
              {removable && admin && (
                <button type="button" onClick={remove} disabled={busy} title="Take out of the combined order"
                        aria-label={`Take PO Line ${r.po_line_number} out of the combined order`}
                        className="rounded p-0.5 text-ink-muted hover:bg-subtle hover:text-ink disabled:opacity-50">
                  <CloseIcon size={13} />
                </button>
              )}
            </span>
          ) : c.label === "MOQ" ? (
            <MoqMark qty={r.qty} />
          ) : c.label === "Firm Date" && r.qty === null ? (
            // Every order with a Qty shows its own Firm Date, inside a combined order too (another line with the same
            // PO Line and Ship Date but no Qty would otherwise show theirs).
            <span className="text-neutral-300">—</span>
          ) : c.value(r, description) ?? <span className="text-neutral-300">—</span>}
        </td>
      ))}
    </tr>
  );
}

// The tinted row of a combined order: the first order's values with the combined Qty and the Ship Date range.
function CombinedTr({ group, members, expanded, description, onToggle }: {
  group: ScheduleGroup; members: OrderRow[]; expanded: boolean; description: string | null; onToggle: () => void;
}) {
  const anchor = members.find((m) => m.id === group.anchor_id) ?? members[0]!;
  // The combined order's own Firm Date (the day it reached the MOQ), not its first order's.
  const merged: OrderRow = { ...anchor, qty: group.total, firm_date: group.firm_date ?? null };
  const first = members[0]?.ship_date;
  const last = members[members.length - 1]?.ship_date;
  return (
    <tr onClick={onToggle} aria-expanded={expanded} className="cursor-pointer bg-tint-violet/70 font-semibold hover:bg-tint-violet">
      <td className="h-11 border-b border-tint-violet-ink/15 pl-5 text-tint-violet-ink">
        {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
      </td>
      {COLUMNS.map((c, i) => (
        <td key={c.label} className={`h-11 whitespace-nowrap border-b border-tint-violet-ink/15 px-3 text-ink last:pr-5 ${
          c.align === "right" ? "tabular text-right" : c.align === "center" ? "text-center" : ""}`}>
          {i === 0 ? (
            <span className="inline-flex items-center gap-1.5">
              {anchor.part_number}
              <span className="rounded border border-tint-violet-ink/25 bg-white px-1.5 py-px text-xs font-medium text-tint-violet-ink">Combined · {members.length}</span>
              {group.below_moq && <span className="rounded bg-age-yellow px-1.5 py-px text-xs font-medium text-age-yellow-ink">Below MOQ {formatQty(group.moq)}</span>}
            </span>
          ) : c.label === "MOQ" ? (
            <MoqMark qty={group.total} />
          ) : c.label === "Ship Date" && first && last ? (
            first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`
          ) : c.value(merged, description) ?? <span className="text-neutral-300">—</span>}
        </td>
      ))}
    </tr>
  );
}

// Under an open combined order: its total against the MOQ and, for an admin once it reached the MOQ, adding later
// orders of the same PO + Part + Type by hand (not after its PO is generated).
function CombinedActions({ group, rows, onChanged }: { group: ScheduleGroup; rows: Map<number, OrderRow>; onChanged?: () => void }) {
  const notify = useToast();
  const admin = can(useSession().user, "orders", "edit"); // Orders edit permission
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const candidates = group.candidate_ids.map((id) => rows.get(id)).filter((r): r is OrderRow => r !== undefined);

  async function add() {
    setBusy(true);
    try {
      await api.post(`/api/orders/${group.anchor_id}/merges`, { member_ids: chosen });
      notify(`${chosen.length} order${chosen.length === 1 ? "" : "s"} added to the combined order.`);
      setAdding(false);
      setChosen([]);
      onChanged?.();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not add the orders.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="bg-tint-violet/25">
      <td colSpan={COLUMNS.length + 1} className="border-b border-tint-violet-ink/15 px-5 py-2.5 text-xs text-ink-muted shadow-[inset_3px_0_0_var(--color-tint-violet-ink)]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>
            Total <span className="tabular font-semibold text-ink">{formatQty(group.total)}</span> · MOQ{" "}
            <span className="tabular font-semibold text-ink">{formatQty(group.moq)}</span>
            {group.placed && " · PO generated, the combined order can no longer change"}
          </span>
          {admin && candidates.length > 0 && !adding && (
            <Button size="sm" onClick={() => setAdding(true)}><PlusIcon size={14} className="text-ink-muted" />Add orders</Button>
          )}
        </div>
        {adding && (
          <div className="mt-2 max-w-xl rounded-md border border-line bg-white p-3">
            <p className="mb-2 font-semibold text-ink">Add later orders of this PO and part</p>
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={chosen.includes(c.id)} className="h-4 w-4 accent-[var(--color-accent)]"
                           onChange={() => setChosen((ids) => (ids.includes(c.id) ? ids.filter((id) => id !== c.id) : [...ids, c.id]))} />
                    PO Line {c.po_line_number} · ship {formatDate(c.ship_date)} · Qty <span className="tabular font-semibold">{c.qty === null ? "—" : formatQty(c.qty)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setChosen([]); }} disabled={busy}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={add} disabled={busy || chosen.length === 0}>{busy ? "Adding…" : `Add ${chosen.length || ""}`.trim()}</Button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

// MOQ column: ✓ when the Qty reaches the part's MOQ, ✗ when it is below ("—" without a Qty or an MOQ).
function MoqMark({ qty }: { qty: string | null }) {
  const moq = useContext(MoqContext);
  if (qty === null || moq === null) return <span className="text-neutral-300">—</span>;
  const reached = Number(qty) >= Number(moq);
  return (
    <span title={`${reached ? "Reached" : "Below"} the MOQ of ${formatQty(moq)}`} aria-label={reached ? "Reached MOQ" : "Below MOQ"}
          className={`text-base font-bold ${reached ? "text-inc" : "text-dec"}`}>
      {reached ? "✓" : "✗"}
    </span>
  );
}
