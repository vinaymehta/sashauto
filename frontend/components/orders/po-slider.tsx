"use client";

import { useState, type ReactNode } from "react";
import { formatDate, formatQty } from "@/lib/format";
import { useApi, useDebounced } from "@/components/use-api";
import { Sheet } from "@/components/ui/sheet";
import { SearchInput } from "@/components/ui/search-input";
import { SortTh, type SortDirection } from "@/components/ui/sort-header";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { SkeletonRows, TableSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RelatedLink } from "@/components/orders/related-popover";
import { FileIcon } from "@/components/icons";

// The orders of a Dashboard card (the Orders list's filters) grouped by Deere PO (GET /api/orders/po_groups): each PO
// with its parts, order lines, Qty and revenue. A PO opens its PO summary (every line with its cost).
export interface PoSliderConfig {
  title: string;
  description?: string;
  icon?: ReactNode;
  filters: Record<string, string | number | undefined>;
  // Columns for the card: open (Qty still open, next ship date), partial (Qty and delivered), outbound (delivered).
  view: "open" | "partial" | "outbound";
}

interface PoGroup { po_number: string; lines: number; parts: string[]; part_count: number; qty: string; delivered: string; delivered_value: string; revenue: string | null; kept: boolean; first_ship: string | null }
interface PoResponse {
  data: PoGroup[];
  meta: { page: number; total: number; total_pages: number; from: number; to: number };
  totals: { pos: number; lines: number; qty: string; delivered: string; delivered_value: string; revenue: string };
}

const dollars = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PoSlider({ config, onClose }: { config: PoSliderConfig; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  // Largest first by the value the list shows: delivered value for Outbound, revenue otherwise.
  const [sort, setSort] = useState(config.view === "outbound" ? "delivered_value" : "revenue");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<PoResponse>("/api/orders/po_groups",
    { ...config.filters, dashboard: 1, q: q || undefined, sort, direction, page, per_page: 50 });

  const onSort = (key: string) => {
    if (sort === key) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDirection(key === "po_number" ? "asc" : "desc"); }
    setPage(1);
  };
  const th = (label: string, key: string, align: "left" | "right" = "left") => (
    <SortTh label={label} sortKey={key} sort={sort} direction={direction} onSort={onSort} align={align} className="whitespace-nowrap px-4 py-2.5" />
  );
  const rows = data?.data ?? [];
  const columnCount = config.view === "partial" ? 7 : 6;
  const meta = data?.meta;
  const t = data?.totals;

  return (
    <Sheet open wide onClose={onClose} title={config.title} description={config.description} icon={config.icon ?? <FileIcon size={18} />}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 shadow-xs">
          <SearchInput value={search} onSearch={(v) => { setSearch(v); setPage(1); }} label="Search POs" placeholder="Search PO or part…" className="w-full sm:w-72" />
          {t && (
            <span className="text-sm text-ink-muted">
              <b className="text-ink">{formatQty(String(t.pos))}</b> POs · <b className="text-ink">{formatQty(String(t.lines))}</b> order lines ·{" "}
              {config.view === "outbound"
                ? <><b className="text-ink">{formatQty(t.delivered)}</b> pcs delivered · <b className="text-ink">{dollars(t.delivered_value)}</b></>
                : config.view === "partial"
                  ? <><b className="text-ink">{formatQty(t.qty)}</b> pcs open (<b className="text-ink">{dollars(t.revenue)}</b>) · <b className="text-ink">{formatQty(t.delivered)}</b> delivered (<b className="text-ink">{dollars(t.delivered_value)}</b>)</>
                  : <><b className="text-ink">{formatQty(t.qty)}</b> pcs · <b className="text-ink">{dollars(t.revenue)}</b></>}
            </span>
          )}
        </div>

        {error ? (
          <Alert title="Could not load the POs">{error.message}</Alert>
        ) : !data && loading ? (
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card"><TableSkeleton rows={10} columns={7} /></div>
        ) : !data || rows.length === 0 ? (
          <div className="rounded-lg border border-line bg-white py-12">
            <EmptyState title="No POs" description={q ? "No PO matches your search." : "No orders make up this card."} />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-neutral-50/75 text-2xs uppercase tracking-wider text-ink-muted">
                    {th("PO", "po_number")}
                    {th("Parts", "part_count")}
                    {th("Order lines", "lines", "right")}
                    {config.view !== "outbound" && th("Open Qty", "qty", "right")}
                    {config.view !== "open" && th("Delivered", "delivered", "right")}
                    {config.view === "open" && th("First ship date", "first_ship")}
                    {config.view !== "outbound" && th(config.view === "partial" ? "Open revenue" : "Revenue", "revenue", "right")}
                    {config.view !== "open" && th("Delivered value", "delivered_value", "right")}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {loading ? <SkeletonRows columns={columnCount} /> : rows.map((g) => (
                    <tr key={g.po_number} className="hover:bg-neutral-50/80">
                      <td className="whitespace-nowrap px-4 py-3">
                        <RelatedLink kind="po" value={g.po_number}><span className="font-semibold">{g.po_number}</span></RelatedLink>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {g.parts.slice(0, 3).map((part) => <RelatedLink key={part} kind="part" value={part} />)}
                          {g.part_count > 3 && <span className="text-xs text-ink-muted">+{g.part_count - 3} more</span>}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-right text-ink">{g.lines}</td>
                      {config.view !== "outbound" && <td className="tabular whitespace-nowrap px-4 py-3 text-right text-ink">{formatQty(g.qty)}</td>}
                      {config.view !== "open" && <td className="tabular whitespace-nowrap px-4 py-3 text-right font-medium text-green-700">{formatQty(g.delivered)}</td>}
                      {config.view === "open" && <td className="tabular whitespace-nowrap px-4 py-3 text-ink">{g.first_ship ? formatDate(g.first_ship) : "—"}</td>}
                      {config.view !== "outbound" && <td className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">{g.revenue === null ? "—" : dollars(g.revenue)}</td>}
                      {config.view !== "open" && <td className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold text-green-700">{dollars(g.delivered_value)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {meta && meta.total_pages > 1 && (
              <footer className="flex items-center justify-between border-t border-line bg-neutral-50 px-4 py-3 text-xs text-ink-muted">
                <span>{meta.from}–{meta.to} of <b className="text-ink">{meta.total}</b> · page <b className="text-ink">{meta.page}</b> of <b className="text-ink">{meta.total_pages}</b></span>
                <span className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={meta.page <= 1 || loading} onClick={() => setPage(meta.page - 1)}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={meta.page >= meta.total_pages || loading} onClick={() => setPage(meta.page + 1)}>Next</Button>
                </span>
              </footer>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
