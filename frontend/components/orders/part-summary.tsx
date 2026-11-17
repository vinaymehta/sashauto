"use client";

import { useState } from "react";
import type { PartSummary } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { useApi } from "../use-api";
import { formatAmount, formatCustomer } from "../vendors/price-format";
import { Badge } from "../ui/badge";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { SortTh, type SortDirection } from "../ui/sort-header";
import { RelatedLink } from "./related-popover";

// Product summary of a Part Number (opened from a Part Number link): the product (description, MOQ), then for its Firm /
// Order orders in the shown order data (`uploadId`; undefined = the current data) what was ordered, dispatched from India
// (delivered included), was delivered to Deere and is still to dispatch, the revenue of what
// was ordered, dispatched and delivered (Deere prices), in total and per PO, and each vendor's price.
export function PartSummaryPanel({ part, uploadId }: { part: string; uploadId?: number }) {
  const { data, error, loading } = useApi<{ data: PartSummary }>("/api/orders/part_summary", { part, upload_id: uploadId });
  const [poSort, setPoSort] = useState<string>("po_number");
  const [poDir, setPoDir] = useState<SortDirection>("asc");
  const [vendorSort, setVendorSort] = useState<string>("name");
  const [vendorDir, setVendorDir] = useState<SortDirection>("asc");

  const toggleSort = (key: string) => {
    if (poSort === key) setPoDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setPoSort(key);
      setPoDir(key === "ordered" || key === "pending" || key === "dispatched" || key === "delivered" || key === "revenue" ? "desc" : "asc");
    }
  };

  const toggleVendorSort = (key: string) => {
    if (vendorSort === key) setVendorDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setVendorSort(key);
      setVendorDir("asc");
    }
  };

  const s = data?.data;
  const sortedPos = (() => {
    if (!s?.pos) return [];
    return [...s.pos].sort((a, b) => {
      let cmp = 0;
      if (poSort === "po_number") cmp = a.po_number.localeCompare(b.po_number, undefined, { numeric: true });
      else if (poSort === "orders") cmp = a.orders - b.orders;
      else if (poSort === "ordered") cmp = Number(a.ordered) - Number(b.ordered);
      else if (poSort === "pending") cmp = Number(a.pending) - Number(b.pending);
      else if (poSort === "dispatched") cmp = Number(a.dispatched) - Number(b.dispatched);
      else if (poSort === "delivered") cmp = Number(a.delivered) - Number(b.delivered);
      else if (poSort === "revenue") cmp = Number(a.revenue_ordered) - Number(b.revenue_ordered);
      else if (poSort === "next_ship_date") cmp = (a.next_ship_date ?? "").localeCompare(b.next_ship_date ?? "");
      return poDir === "desc" ? -cmp : cmp;
    });
  })();

  const sortedVendors = (() => {
    if (!s?.vendors) return [];
    return [...s.vendors].sort((a, b) => {
      let cmp = 0;
      if (vendorSort === "name") cmp = a.name.localeCompare(b.name);
      else if (vendorSort === "price") cmp = (Number(a.price) || 0) - (Number(b.price) || 0);
      else if (vendorSort === "set_price") cmp = (Number(a.set_price) || 0) - (Number(b.set_price) || 0);
      else if (vendorSort === "moq") cmp = (Number(a.moq) || 0) - (Number(b.moq) || 0);
      return vendorDir === "desc" ? -cmp : cmp;
    });
  })();

  if (error) return <Alert title="Could not load the product summary">{error.message}</Alert>;
  if (loading || !data || !s) return <Skeleton className="h-96 w-full" />;
  const t = s.totals;
  const ordered = Number(t.ordered);
  const pct = (v: string) => (ordered > 0 ? Math.min((Number(v) / ordered) * 100, 100) : 0);
  // Deere amounts in the business's currency (plain numbers when the businesses shown use different ones).
  const money = (v: string) => (s.currency ? formatCustomer(v, s.currency, 2) : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const tiles: { label: string; value: string; tone: string; dot: string }[] = [
    { label: "Total ordered", value: t.ordered, tone: "text-ink", dot: "bg-neutral-400" },
    { label: "Delivered to Deere", value: t.delivered, tone: "text-green-700", dot: "bg-green-600" },
    { label: "In transit", value: t.in_transit, tone: "text-violet-700", dot: "bg-violet-500" },
    { label: "Dispatched", value: t.dispatched, tone: "text-violet-700", dot: "bg-violet-500" },
    { label: "Pending as per DTP", value: t.pending_dtp, tone: Number(t.pending_dtp) > 0 ? "text-amber-700" : "text-ink-faint", dot: "bg-neutral-300" },
    { label: "Pending to dispatch", value: t.pending, tone: Number(t.pending) > 0 ? "text-amber-700" : "text-ink-faint", dot: "bg-neutral-300" },
  ];

  return (
    <div className="space-y-4">
      {/* The product */}
      <section className="rounded-lg border border-line bg-gradient-to-br from-tint-violet/70 via-white to-white px-5 py-4 shadow-card">
        <div className="flex items-start gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight text-ink">{s.part_number}</h3>
              {s.discontinued && <Badge tone="dark">Discontinued</Badge>}
            </div>
            {s.description && <p className="mt-1 text-sm text-ink-muted">{s.description}</p>}
          </div>
        </div>
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

      {/* Totals at a glance, with one bar (delivered | dispatched, not yet delivered | still to dispatch) */}
      <section className="space-y-3 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-line">
              <span className="flex items-center gap-1.5 text-xs text-ink-muted"><span className={`h-2 w-2 rounded-full ${tile.dot}`} />{tile.label}</span>
              <span className={`block text-xl font-semibold tabular ${tile.tone}`}>{formatQty(tile.value)}</span>
            </div>
          ))}
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-200" role="img"
             aria-label={`${t.dispatched} dispatched (${t.delivered} delivered), ${t.pending} still to dispatch of ${t.ordered}`}>
          <span className="bg-green-600" style={{ width: `${pct(t.delivered)}%` }} />
          <span className="bg-violet-500" style={{ width: `${pct(t.in_transit)}%` }} />
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
          {/* Dispatched counts goods on the way too; delivered only what Deere has received (SASH Inc invoice or Outbound). */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="min-w-0 rounded-md bg-neutral-50 px-3 py-2 ring-1 ring-line">
              <span className="block text-xs text-ink-muted">On Qty ordered</span>
              <span className="block truncate text-lg font-semibold tabular text-ink">{money(t.revenue_ordered)}</span>
            </div>
            <div className="min-w-0 rounded-md bg-violet-50/60 px-3 py-2 ring-1 ring-violet-200">
              <span className="block text-xs text-ink-muted">On Qty dispatched</span>
              <span className="block truncate text-lg font-semibold tabular text-violet-700">{money(t.revenue_dispatched ?? "0")}</span>
            </div>
            <div className="min-w-0 rounded-md bg-green-50/60 px-3 py-2 ring-1 ring-green-200">
              <span className="block text-xs text-ink-muted">On Qty delivered to Deere</span>
              <span className="block truncate text-lg font-semibold tabular text-green-700">{money(t.revenue_delivered)}</span>
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
                  <SortTh label="Vendor" sortKey="name" sort={vendorSort} direction={vendorDir} onSort={toggleVendorSort} className="px-5 py-2 font-semibold" />
                  <SortTh label="Per piece" sortKey="price" align="right" sort={vendorSort} direction={vendorDir} onSort={toggleVendorSort} className="px-3 py-2 text-right font-semibold" />
                  <SortTh label="Per set" sortKey="set_price" align="right" sort={vendorSort} direction={vendorDir} onSort={toggleVendorSort} className="px-3 py-2 text-right font-semibold" />
                  <SortTh label="MOQ" sortKey="moq" align="right" sort={vendorSort} direction={vendorDir} onSort={toggleVendorSort} className="px-5 py-2 text-right font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sortedVendors.map((v) => (
                  <tr key={v.name}>
                    <td className="px-5 py-2 font-medium text-ink"><RelatedLink kind="vendor" value={v.name} id={v.vendor_id} uploadId={uploadId} />{v.note && <span className="block text-xs font-normal text-ink-muted">{v.note}</span>}</td>
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
                  <SortTh label="PO Number" sortKey="po_number" sort={poSort} direction={poDir} onSort={toggleSort} className="px-5 py-2 font-semibold" />
                  <SortTh label="Orders" sortKey="orders" sort={poSort} direction={poDir} onSort={toggleSort} className="px-3 py-2 font-semibold" />
                  <SortTh label="Ordered" sortKey="ordered" align="right" sort={poSort} direction={poDir} onSort={toggleSort} className="px-3 py-2 text-right font-semibold" />
                  <SortTh label="Pending" sortKey="pending" align="right" sort={poSort} direction={poDir} onSort={toggleSort} className="px-3 py-2 text-right font-semibold" />
                  <SortTh label="Dispatched" sortKey="dispatched" align="right" sort={poSort} direction={poDir} onSort={toggleSort} className="px-3 py-2 text-right font-semibold" />
                  <SortTh label="Delivered" sortKey="delivered" align="right" sort={poSort} direction={poDir} onSort={toggleSort} className="px-3 py-2 text-right font-semibold" />
                  <SortTh label="Revenue" sortKey="revenue" align="right" sort={poSort} direction={poDir} onSort={toggleSort} className="px-3 py-2 text-right font-semibold" />
                  <SortTh label="Next ship date" sortKey="next_ship_date" sort={poSort} direction={poDir} onSort={toggleSort} className="px-5 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sortedPos.map((p) => (
                  <tr key={p.po_number} className="hover:bg-neutral-50">
                    <td className="px-5 py-2 font-semibold text-ink"><RelatedLink kind="po" value={p.po_number} uploadId={uploadId} /><span className="ml-2 text-xs font-normal text-ink-muted">{p.types.join(", ")}</span></td>
                    <td className="px-3 py-2 text-ink-muted">{formatCount(p.orders)}{p.open_orders > 0 ? ` (${formatCount(p.open_orders)} open)` : ""}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{formatQty(p.ordered)}</td>
                    <td className={`px-3 py-2 text-right tabular font-semibold ${Number(p.pending) > 0 ? "text-amber-700" : "text-ink-faint"}`}>{formatQty(p.pending)}</td>
                    <td className="px-3 py-2 text-right tabular text-violet-700">{formatQty(p.dispatched)}</td>
                    <td className="px-3 py-2 text-right tabular text-green-700">{formatQty(p.delivered)}</td>
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
