"use client";

import type { PoSummary } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { useApi } from "../use-api";
import { formatCustomer } from "../vendors/price-format";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { StatusPill } from "./delivery-cell";
import { RelatedLink } from "./related-popover";

// PO summary (opened from a PO Number link): for the PO's Firm / Order lines in the shown order data (`uploadId`;
// undefined = the current data) what was ordered, dispatched from India, is in transit, was delivered to Deere and is
// still to dispatch, with the revenue (Deere prices), then each line with its status. A Part Number opens its Product
// summary in the same panel.
export function PoSummaryPanel({ po, uploadId }: { po: string; uploadId?: number }) {
  const { data, error, loading } = useApi<{ data: PoSummary }>("/api/orders/po_summary", { po, upload_id: uploadId });
  if (error) return <Alert title="Could not load the PO summary">{error.message}</Alert>;
  if (loading || !data) return <Skeleton className="h-96 w-full" />;
  const s = data.data;
  const t = s.totals;
  const ordered = Number(t.ordered);
  const pct = (v: string) => (ordered > 0 ? Math.min((Number(v) / ordered) * 100, 100) : 0);
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
      <section className="rounded-lg border border-line bg-gradient-to-br from-tint-violet/70 via-white to-white px-5 py-4 shadow-card">
        <h3 className="text-xl font-semibold tracking-tight text-ink">PO {s.po_number}</h3>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {([["Parts", formatCount(t.parts)], ["Orders", `${formatCount(t.orders)} (${formatCount(t.open_orders)} open)`],
             ["Forecast", t.forecast_rows ? `${formatQty(t.forecast)} (${formatCount(t.forecast_rows)} rows)` : "—"],
             ["Revenue (ordered)", money(t.revenue_ordered)], ["Revenue (dispatched)", money(t.revenue_dispatched ?? "0")],
             ["Revenue (delivered to Deere)", money(t.revenue_delivered)]] as [string, string][]).map(([label, value]) => (
            <span key={label} className="max-w-full truncate rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line" title={value}>
              {label} <span className="font-semibold text-ink">{value}</span>
            </span>
          ))}
        </div>
      </section>

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
        {t.unpriced > 0 && <p className="text-xs text-amber-700">{formatCount(t.unpriced)} order{t.unpriced === 1 ? "" : "s"} without a Deere price, left out of the revenue.</p>}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Order lines</h3>
          <span className="text-xs text-ink-muted">{formatCount(s.lines.length)} line{s.lines.length === 1 ? "" : "s"} · Firm and Order</span>
        </div>
        {s.lines.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No Firm or Order rows of this PO in the shown order data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  <th className="px-5 py-2 font-semibold">Line</th>
                  <th className="px-3 py-2 font-semibold">Part Number</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Ship date</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 text-right font-semibold">Ordered</th>
                  <th className="px-2 py-2 text-right font-semibold">Dispatched</th>
                  <th className="px-2 py-2 text-right font-semibold">Delivered</th>
                  <th className="px-2 py-2 text-right font-semibold">Pending</th>
                  <th className="px-5 py-2 text-right font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {s.lines.map((l) => (
                  <tr key={`${l.po_line_number}|${l.part_number}|${l.ship_date}|${l.order_type}`} className="hover:bg-neutral-50">
                    <td className="px-5 py-2 tabular text-ink-muted">{l.po_line_number}</td>
                    <td className="px-3 py-2">
                      <RelatedLink kind="part" value={l.part_number} uploadId={uploadId} />
                      {l.description && <span className="block max-w-48 truncate text-xs text-ink-muted" title={l.description}>{l.description}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink">{l.order_type}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink">{formatDate(l.ship_date)}</td>
                    <td className="px-3 py-2"><StatusPill kind={l.status} /></td>
                    <td className="px-2 py-2 text-right tabular text-ink">{formatQty(l.ordered)}</td>
                    <td className="px-2 py-2 text-right tabular text-violet-700">{formatQty(l.dispatched)}</td>
                    <td className="px-2 py-2 text-right tabular text-green-700">{formatQty(l.delivered)}</td>
                    <td className={`px-3 py-2 text-right tabular font-semibold ${Number(l.pending) > 0 ? "text-amber-700" : "text-ink-faint"}`}>{formatQty(l.pending)}</td>
                    <td className="px-5 py-2 text-right tabular text-ink">{l.unpriced ? <span className="text-ink-faint">—</span> : money(l.revenue_ordered)}</td>
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
