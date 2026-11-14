"use client";

import { useState, type ReactNode } from "react";
import { formatDate, formatDateOnly, formatQty } from "@/lib/format";
import type { OrderHistory, OrderRow, OrderStatus, VendorOrderState } from "@/lib/types";
import { BoxIcon, CheckIcon, ChevronDownIcon, FileIcon, MapPinIcon, TruckIcon } from "../icons";
import { useApi } from "../use-api";
import { Skeleton } from "../ui/skeleton";
import { StatusPill } from "./delivery-cell";
import { RelatedLink } from "./related-popover";

const dash = <span className="text-ink-faint">—</span>;
const RANK: Record<OrderStatus, number> = { none: 0, received: 1, dispatch: 2, dispatched: 3, inbound: 4, delivery: 5, outbound: 6 };

type Step = { label: string; date: string | null; state: "done" | "part" | "todo"; Icon: typeof BoxIcon; note?: string };

// Order details → "This order": the one order that was opened (its own row of Deere's file). Its card (status, dates,
// file), its way from Deere's order to delivery as steps, its Qty figures, its invoices and vendor POs side by side, and
// every column of Deere's file (folded).
export function ThisOrder({ row, file }: { row: OrderRow; file?: OrderHistory["file"] }) {
  const vendor = useApi<{ data: VendorOrderState }>(`/api/orders/${row.id}/vendor_order${row.manual ? "?manual=1" : ""}`);
  const [allColumns, setAllColumns] = useState(false);
  const rank = RANK[row.status ?? "none"];
  const marks = row.deliveries ?? {};
  const moves = row.invoice_moves ?? [];
  const india = moves.filter((m) => m.kind === "india");
  const inc = moves.filter((m) => m.kind === "inc");
  const listed = marks.dispatched?.invoice_lines ?? [];
  const vendorOrders = (vendor.data?.data.placements ?? []).flatMap((p) => p.vendor_orders);
  const placedAt = vendorOrders.map((v) => v.order_placed_at).filter((d): d is string => !!d).sort()[0] ?? null;
  const allReceived = vendorOrders.length > 0 && vendorOrders.every((v) => v.goods_received_at);
  const source = Object.entries(row.source_data ?? {}).filter(([, v]) => v !== null && String(v).trim() !== "");

  const order = Number(row.order_qty ?? row.qty ?? 0);
  const shipped = Number(row.shipped_qty ?? 0);
  const delivered = Number(row.outbound_qty ?? 0);
  const balance = Math.max(order - shipped, 0);
  const pct = (n: number) => (order > 0 ? Math.min((n / order) * 100, 100) : 0);

  const steps: Step[] = [
    { label: "Order from Deere", date: row.came_firm_date ? formatDate(row.came_firm_date) : null, state: "done", Icon: FileIcon, note: row.order_type },
    { label: "Vendor PO", date: placedAt ? formatDateOnly(placedAt) : null, state: vendorOrders.length ? "done" : "todo", Icon: FileIcon,
      note: vendorOrders.length ? `${vendorOrders.length} PO${vendorOrders.length === 1 ? "" : "s"}` : undefined },
    { label: "Received", date: marks.received ? formatDate(marks.received.delivered_on) : null,
      state: rank >= 1 || allReceived ? "done" : vendorOrders.some((v) => Number(v.received_qty ?? 0) > 0) ? "part" : "todo", Icon: BoxIcon },
    { label: "Dispatched", date: marks.dispatched ? formatDate(marks.dispatched.delivered_on) : india[0] ? formatDate(india[0].invoice_date) : null,
      state: rank >= 3 ? "done" : rank === 2 ? "part" : "todo", Icon: TruckIcon, note: shipped ? `${formatQty(String(shipped))} pcs` : undefined },
    { label: "Inbound", date: marks.inbound ? formatDate(marks.inbound.delivered_on) : null, state: rank >= 4 ? "done" : "todo", Icon: MapPinIcon },
    { label: "Outbound", date: marks.outbound ? formatDate(marks.outbound.delivered_on) : inc[0] ? formatDate(inc[0].invoice_date) : null,
      state: rank >= 6 ? "done" : rank === 5 ? "part" : "todo", Icon: CheckIcon, note: delivered ? `${formatQty(String(delivered))} pcs` : undefined },
  ];

  const facts: [string, ReactNode][] = [
    ["Ship date", formatDate(row.ship_date)],
    ["Firm Date", row.came_firm_date ? formatDate(row.came_firm_date) : null],
    ["Effective Firm Date", row.firm_date ? formatDate(row.firm_date) : null],
    ["Due date", row.due_date ? formatDate(row.due_date) : null],
  ];
  const chips: [string, string | null][] = [
    ["PO Line", row.po_line_number],
    ["Supplier Part Number", row.supplier_part_number],
    ["Unit", row.unit?.trim() || null],
  ];
  const invoiceCount = india.length + inc.length + (india.length ? 0 : listed.length);

  return (
    <div className="space-y-4">
      {/* The order: part, status, file, dates */}
      <section className="overflow-hidden rounded-lg border border-line bg-gradient-to-br from-tint-violet/70 via-white to-white shadow-card">
        <div className="flex min-w-0 items-start gap-4 px-5 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-tint-violet-ink shadow-card ring-1 ring-tint-violet-ink/15">
            <BoxIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight text-ink"><RelatedLink kind="part" value={row.part_number} /></h3>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-tint-violet-ink ring-1 ring-tint-violet-ink/20">{row.order_type}</span>
              {row.status && <StatusPill kind={row.status} />}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line">PO <span className="tabular font-semibold text-ink"><RelatedLink kind="po" value={row.po_number} /></span></span>
              {chips.filter(([, v]) => v).map(([label, v]) => (
                <span key={label} className="max-w-full truncate rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line" title={v ?? undefined}>
                  {label} <span className="font-semibold text-ink">{v}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line/70 bg-line/70 sm:grid-cols-5">
          {facts.map(([label, v]) => (
            <div key={label} className="bg-white px-5 py-3">
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink">{v ?? dash}</dd>
            </div>
          ))}
          <div className="col-span-2 bg-white px-5 py-3 sm:col-span-1">
            <dt className="text-xs text-ink-muted">Deere file</dt>
            <dd className="mt-0.5 text-sm font-semibold">
              {file ? (
                <span className={file.latest ? "text-inc" : "text-age-yellow-ink"} title={file.name}>
                  {file.latest ? "Latest" : "Old file"}{file.day ? ` · ${formatDate(file.day)}` : ""}
                </span>
              ) : row.manual ? "Manual order" : dash}
            </dd>
          </div>
        </dl>
      </section>

      {/* Its way: Deere's order → vendor PO → received → dispatched → inbound → outbound */}
      <section className="rounded-lg border border-line bg-white px-5 py-5 shadow-card">
        <ol className="grid grid-cols-3 gap-y-5 sm:grid-cols-6">
          {steps.map((s, i) => (
            <li key={s.label} className="relative flex flex-col items-center text-center">
              {i > 0 && <span className={`absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 ${s.state === "todo" ? "bg-neutral-200" : "bg-inc"}`} aria-hidden />}
              <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-white ${
                s.state === "done" ? "bg-inc text-white" : s.state === "part" ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-ink-faint"}`}>
                <s.Icon size={15} />
              </span>
              <span className={`mt-2 text-xs font-semibold ${s.state === "todo" ? "text-ink-faint" : "text-ink"}`}>{s.label}{s.state === "part" ? " (part)" : ""}</span>
              <span className="text-xs text-ink-muted">{s.date ?? (s.state === "todo" ? "Not yet" : "—")}</span>
              {s.note && <span className="text-2xs text-ink-faint">{s.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      {/* Qty */}
      <section className="space-y-3 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ["Order Qty", order, "text-ink", "bg-neutral-400"],
            ["Pending to dispatch", balance, balance > 0 ? "text-amber-700" : "text-ink-faint", "bg-neutral-300"],
            ["Dispatched", shipped, "text-violet-700", "bg-violet-500"],
            ["Delivered to Deere", delivered, "text-green-700", "bg-green-600"],
          ] as const).map(([label, value, tone, dot]) => (
            <div key={label} className="rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-line">
              <span className="flex items-center gap-1.5 text-xs text-ink-muted"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</span>
              <span className={`block text-lg font-semibold tabular ${tone}`}>{formatQty(String(value))}</span>
            </div>
          ))}
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-200" role="img"
             aria-label={`${shipped} dispatched (${delivered} delivered to Deere) of ${order}`}>
          <span className="bg-green-600" style={{ width: `${pct(delivered)}%` }} />
          <span className="bg-violet-500" style={{ width: `${pct(Math.max(shipped - delivered, 0))}%` }} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Invoices: the dispatched orders list's (when no SASH India invoice is uploaded), SASH India, SASH Inc */}
        <Card title="Invoices" count={invoiceCount}>
          {invoiceCount === 0 ? <Empty>No invoice for this order yet.</Empty> : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {(india.length ? [] : listed).map((l, i) => (
                <InvoiceLine key={`l${i}`} kind="india" number={l.invoice} date={l.date} qty={l.qty} hint="Dispatched orders list" />
              ))}
              {india.map((m) => <InvoiceLine key={`i${m.invoice_id}`} kind="india" number={m.invoice_number} date={m.invoice_date} qty={m.qty} hint="SASH India invoice" />)}
              {inc.map((m) => <InvoiceLine key={`c${m.invoice_id}`} kind="inc" number={m.invoice_number} date={m.invoice_date} qty={m.qty} hint="SASH Inc invoice" />)}
            </ul>
          )}
        </Card>

        {/* Vendor POs */}
        <Card title="Vendor POs" count={vendorOrders.length}>
          {vendor.loading && !vendor.data ? <div className="p-4"><Skeleton className="h-10 w-full" /></div>
            : vendorOrders.length === 0 ? <Empty>No vendor PO for this order.</Empty> : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {vendorOrders.map((vo) => {
                  const got = Number(vo.received_qty ?? 0);
                  return (
                    <li key={vo.id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink" title={vo.number}>{vo.number}</span>
                        <span className="block truncate text-xs text-ink-muted">{vo.vendor_name} · {vo.order_placed_at ? formatDateOnly(vo.order_placed_at) : "not placed"}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular font-semibold text-ink">{formatQty(vo.qty)} {vo.unit}</span>
                        <span className={`block text-xs ${vo.goods_received_at ? "text-inc" : got > 0 ? "text-amber-700" : "text-ink-faint"}`}>
                          {vo.goods_received_at ? "Received" : got > 0 ? `${formatQty(String(got))} received` : "Not received"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
        </Card>
      </div>

      {/* Deere's file, folded */}
      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <button type="button" onClick={() => setAllColumns((v) => !v)} aria-expanded={allColumns}
                className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-neutral-50">
          <span className="text-sm font-semibold text-ink">All columns from Deere&apos;s file <span className="font-normal text-ink-muted">· {source.length}</span></span>
          <ChevronDownIcon size={16} className={`text-ink-muted transition-transform ${allColumns ? "rotate-180" : ""}`} />
        </button>
        {allColumns && (
          <dl className="grid gap-x-6 gap-y-2 border-t border-neutral-100 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {source.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="truncate text-xs text-ink-muted" title={k}>{k}</dt>
                <dd className="truncate font-medium text-ink" title={String(v)}>{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

function InvoiceLine({ kind, number, date, qty, hint }: { kind: "india" | "inc"; number: string; date: string; qty: string | null; hint: string }) {
  const Icon = kind === "india" ? TruckIcon : CheckIcon;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${kind === "india" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-green-50 text-green-700 ring-green-200"}`}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{number}</span>
        <span className="block text-xs text-ink-muted">{date ? formatDate(date) : "—"} · {hint}</span>
      </span>
      <span className="tabular font-semibold text-ink">{qty ? formatQty(qty) : "—"}</span>
    </li>
  );
}

function Card({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {count !== undefined && <span className="text-xs text-ink-muted">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-3 text-sm text-ink-muted">{children}</p>;
}
