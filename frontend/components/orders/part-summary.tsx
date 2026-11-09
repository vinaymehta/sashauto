"use client";

import type { PartSummary } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { useApi } from "../use-api";
import { formatAmount, formatCustomer } from "../vendors/price-format";
import { Badge } from "../ui/badge";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";

// Product summary of a Part Number (opened from a Part Number link): the product (description, MOQ), then for its Firm /
// Order orders in the shown order data (`uploadId`; undefined = the current data) what was ordered, dispatched from India,
// is in transit, was delivered to Deere and is still to dispatch, the revenue of what was ordered and delivered (Deere
// prices), in total and per PO, and each vendor's price.
export function PartSummaryPanel({ part, uploadId }: { part: string; uploadId?: number }) {
  const { data, error, loading } = useApi<{ data: PartSummary }>("/api/orders/part_summary", { part, upload_id: uploadId });
  if (error) return <Alert title="Could not load the product summary">{error.message}</Alert>;
  if (loading || !data) return <Skeleton className="h-96 w-full" />;
  const s = data.data;
  const t = s.totals;
  const ordered = Number(t.ordered);
  const pct = (v: string) => (ordered > 0 ? Math.min((Number(v) / ordered) * 100, 100) : 0);
  // Deere amounts in the business's currency (plain numbers when the businesses shown use different ones).
  const money = (v: string) => (s.currency ? formatCustomer(v, s.currency, 2) : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const tiles: { label: string; value: string; tone: string; dot: string }[] = [
    { label: "Total ordered", value: t.ordered, tone: "text-ink", dot: "bg-neutral-400" },
    { label: "Dispatched", value: t.dispatched, tone: "text-violet-700", dot: "bg-violet-500" },
    { label: "In transit", value: t.in_transit, tone: "text-blue-700", dot: "bg-blue-500" },
    { label: "Delivered to Deere", value: t.delivered, tone: "text-green-700", dot: "bg-green-600" },
    { label: "Pending to dispatch", value: t.pending, tone: Number(t.pending) > 0 ? "text-amber-700" : "text-ink-faint", dot: "bg-neutral-300" },
  ];

  return (
    <div className="space-y-4">
      {/* The product */}
      <section className="rounded-lg border border-line bg-gradient-to-br from-tint-violet/70 via-white to-white px-5 py-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-semibold tracking-tight text-ink">{s.part_number}</h3>
          {s.discontinued && <Badge tone="dark">Discontinued</Badge>}
        </div>
        {s.description && <p className="mt-1 text-sm text-ink-muted">{s.description}</p>}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {([["MOQ", s.moq ? formatQty(s.moq) : "—"], ["Pack", s.pack_size && s.pack_size > 1 ? `${s.pack_size} pcs per set` : "—"],
             ["Vendors", s.vendors.length ? formatCount(s.vendors.length) : "—"], ["POs", formatCount(t.pos)],
             ["Orders", `${formatCount(t.orders)} (${formatCount(t.open_orders)} open)`]] as [string, string][]).map(([label, value]) => (
            <span key={label} className="max-w-full truncate rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line" title={value}>
              {label} <span className="font-semibold text-ink">{value}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Totals at a glance, with one bar (delivered | in transit | still to dispatch) */}
      <section className="space-y-3 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-line">
              <span className="flex items-center gap-1.5 text-xs text-ink-muted"><span className={`h-2 w-2 rounded-full ${tile.dot}`} />{tile.label}</span>
              <span className={`block text-xl font-semibold tabular ${tile.tone}`}>{formatQty(tile.value)}</span>
            </div>
          ))}
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-200" role="img"
             aria-label={`${t.delivered} delivered, ${t.in_transit} in transit, ${t.pending} still to dispatch of ${t.ordered}`}>
          <span className="bg-green-600" style={{ width: `${pct(t.delivered)}%` }} />
          <span className="bg-blue-500" style={{ width: `${pct(t.in_transit)}%` }} />
        </div>
        <p className="text-xs text-ink-muted">
          Firm and Order rows of the shown order data. Forecast (not ordered yet) <span className="tabular font-semibold text-ink">{formatQty(t.forecast)}</span>
          {" · "}On vendor POs <span className="tabular font-semibold text-ink">{formatQty(t.vendor_po)}</span>
        </p>
      </section>

      {/* Revenue from Deere (Qty × Deere Unit Price ÷ 100) and each vendor's price */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          <h3 className="text-sm font-semibold text-ink">Revenue</h3>
          <p className="text-xs text-ink-muted">Qty × Deere Unit Price ÷ 100{s.currency ? ` · ${s.currency}` : ""}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-line">
              <span className="block text-xs text-ink-muted">On Qty ordered</span>
              <span className="block text-xl font-semibold tabular text-ink">{money(t.revenue_ordered)}</span>
            </div>
            <div className="rounded-md bg-green-50/60 px-3 py-2 ring-1 ring-green-200">
              <span className="block text-xs text-ink-muted">On Qty delivered</span>
              <span className="block text-xl font-semibold tabular text-green-700">{money(t.revenue_delivered)}</span>
            </div>
          </div>
          {t.unpriced > 0 && <p className="mt-2 text-xs text-amber-700">{formatCount(t.unpriced)} order{t.unpriced === 1 ? "" : "s"} without a Deere price, left out.</p>}
        </section>
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <div className="border-b border-neutral-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-ink">Vendors &amp; prices</h3>
            <p className="text-xs text-ink-muted">Each vendor&apos;s price for this part (Products)</p>
          </div>
          {s.vendors.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">No vendor for this part yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  <th className="px-5 py-2 font-semibold">Vendor</th>
                  <th className="px-3 py-2 text-right font-semibold">Per piece</th>
                  <th className="px-3 py-2 text-right font-semibold">Per set</th>
                  <th className="px-5 py-2 text-right font-semibold">MOQ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {s.vendors.map((v) => (
                  <tr key={v.name}>
                    <td className="px-5 py-2 font-medium text-ink">{v.name}{v.note && <span className="block text-xs font-normal text-ink-muted">{v.note}</span>}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{formatAmount(v.price, v.currency) ?? <span className="text-ink-faint">{v.price_text ?? "—"}</span>}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-muted">{v.pack_size > 1 ? `${formatAmount(v.set_price, v.currency) ?? "—"} (${v.pack_size} pcs)` : "—"}</td>
                    <td className="px-5 py-2 text-right tabular text-ink-muted">{v.moq ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Per PO */}
      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">By PO</h3>
          <span className="text-xs text-ink-muted">{formatCount(s.pos.length)} PO{s.pos.length === 1 ? "" : "s"}, by first ship date</span>
        </div>
        {s.pos.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No Firm or Order rows of this part in the shown order data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  <th className="px-5 py-2 font-semibold">PO Number</th>
                  <th className="px-3 py-2 font-semibold">Orders</th>
                  <th className="px-3 py-2 text-right font-semibold">Ordered</th>
                  <th className="px-3 py-2 text-right font-semibold">Dispatched</th>
                  <th className="px-3 py-2 text-right font-semibold">In transit</th>
                  <th className="px-3 py-2 text-right font-semibold">Delivered</th>
                  <th className="px-3 py-2 text-right font-semibold">Pending</th>
                  <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                  <th className="px-5 py-2 font-semibold">Next ship date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {s.pos.map((p) => (
                  <tr key={p.po_number} className="hover:bg-neutral-50">
                    <td className="px-5 py-2 font-semibold text-ink">{p.po_number}<span className="ml-2 text-xs font-normal text-ink-muted">{p.types.join(", ")}</span></td>
                    <td className="px-3 py-2 text-ink-muted">{formatCount(p.orders)}{p.open_orders > 0 ? ` (${formatCount(p.open_orders)} open)` : ""}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{formatQty(p.ordered)}</td>
                    <td className="px-3 py-2 text-right tabular text-violet-700">{formatQty(p.dispatched)}</td>
                    <td className="px-3 py-2 text-right tabular text-blue-700">{formatQty(p.in_transit)}</td>
                    <td className="px-3 py-2 text-right tabular text-green-700">{formatQty(p.delivered)}</td>
                    <td className={`px-3 py-2 text-right tabular font-semibold ${Number(p.pending) > 0 ? "text-amber-700" : "text-ink-faint"}`}>{formatQty(p.pending)}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{money(p.revenue_ordered)}</td>
                    <td className="px-5 py-2 text-ink">{p.next_ship_date ? formatDate(p.next_ship_date) : <span className="text-ink-faint">All dispatched</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
