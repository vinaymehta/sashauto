"use client";

import { useState, type ReactNode } from "react";
import type { OrderStatus, OrderType, ProductImage } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { useApi, useDebounced } from "@/components/use-api";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { SearchInput } from "@/components/ui/search-input";
import { SortTh, type SortDirection } from "@/components/ui/sort-header";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { SkeletonRows, TableSkeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/orders/delivery-cell";
import { RelatedLink } from "@/components/orders/related-popover";
import { PartThumbnail } from "@/components/products/part-thumbnail";
import { FileIcon } from "@/components/icons";

// The rows behind one Dashboard money figure, each with its own share of the figure, adding up to the card:
//   lines     a Fulfilment figure (GET /api/orders/fulfilment_lines?figure=…): the order lines with that figure's Qty
//   supplier  Total Open Value (Supplier) (GET /api/stats/supplier_orders): the open vendor POs, the price used and its source
//   ytd       YTD Customer Spend (GET /api/stats/ytd_orders): the order rows shipping from 1 April to today
export type FigureSliderConfig =
  | { kind: "lines"; title: string; description?: string; icon?: ReactNode; figure: string; qtyLabel: string; business?: string; part_number?: string }
  | { kind: "supplier"; title: string; description?: string; icon?: ReactNode }
  | { kind: "ytd"; title: string; description?: string; icon?: ReactNode };

// One row of any of the three lists (the fields a kind does not have are absent).
export interface FigureRow {
  id: number | null;
  manual?: boolean;
  kept?: boolean;
  business?: string;
  number?: string; // vendor PO
  vendor?: string;
  po_number: string | null;
  po_line_number: string | null;
  part_number: string | null;
  description: string | null;
  order_type?: OrderType;
  ship_date: string | null;
  status?: OrderStatus;
  file?: string;
  file_name?: string | null;
  qty: string;
  price: string | null;
  currency?: string;
  price_source?: string;
  value: string | null;
  order_row_id?: number | null;
  manual_order_id?: number | null;
  image_url?: string | null;
  images?: ProductImage[];
}

// One page of rows; meta: the page (total = rows found); totals: of every row found (all pages), equal to the card
// without a search (supplier: per currency).
interface FigureResponse {
  data: FigureRow[];
  meta: { page: number; per_page: number; total: number; total_pages: number; from: number; to: number };
  currency?: string | null;
  totals: { qty: string; value?: string; by_currency?: { currency: string; amount: string }[] };
}

// The order a row is for, to open its Order details (vendor POs: the order they were placed for).
export interface FigureOrder { id: number; manual: boolean; po_number: string; po_line_number: string; part_number: string; order_type: OrderType; ship_date: string; qty: string }

const ENDPOINT = { lines: "/api/orders/fulfilment_lines", supplier: "/api/stats/supplier_orders", ytd: "/api/stats/ytd_orders" } as const;

function money(amount: string | number, currency: string | null | undefined) {
  if (!currency) return Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount));
}

export function FigureSlider({ config, onClose, onOpenOrder }: { config: FigureSliderConfig; onClose: () => void; onOpenOrder: (order: FigureOrder) => void }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [sort, setSort] = useState("value");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  // Searching, sorting and paging happen on the server, over all the rows.
  const query = { ...(config.kind === "lines" ? { figure: config.figure, business: config.business, part_number: config.part_number } : {}),
                  q: q || undefined, sort, direction, page, per_page: 50 };
  const { data, error, loading } = useApi<FigureResponse>(ENDPOINT[config.kind], query);

  const onSort = (key: string) => {
    if (sort === key) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection(["qty", "price", "value"].includes(key) ? "desc" : "asc");
    }
    setPage(1);
  };

  const rows = data?.data ?? [];
  const meta = data?.meta;
  const currency = data?.currency ?? null;
  const totalValue = data?.totals.by_currency
    ? data.totals.by_currency.map((t) => money(t.amount, t.currency)).join(" + ") || "—"
    : data?.totals.value !== undefined ? money(data.totals.value, currency) : "—";

  const orderOf = (r: FigureRow): FigureOrder | null => {
    const id = r.id !== null && config.kind !== "supplier" ? r.id : (r.order_row_id ?? r.manual_order_id ?? null);
    if (id === null || !r.po_number || !r.part_number || !r.ship_date) return null;
    return { id, manual: config.kind === "supplier" ? !r.order_row_id : Boolean(r.manual), po_number: r.po_number, po_line_number: r.po_line_number ?? "",
             part_number: r.part_number, order_type: r.order_type ?? "Firm", ship_date: r.ship_date, qty: r.qty };
  };

  const th = (label: string, key: string, align: "left" | "right" = "left") => (
    <SortTh label={label} sortKey={key} sort={sort} direction={direction} onSort={onSort} align={align} className="whitespace-nowrap px-3 py-2.5" />
  );
  const lines = config.kind === "lines";
  const supplier = config.kind === "supplier";
  const columns = supplier ? 9 : lines ? 8 : 6;

  return (
    <Sheet open wide onClose={onClose} title={config.title} description={config.description} icon={config.icon ?? <FileIcon size={18} />}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 shadow-xs">
          <SearchInput value={search} onSearch={(v) => { setSearch(v); setPage(1); }} label="Search" placeholder={supplier ? "Search vendor PO, vendor, part…" : "Search part, PO, description…"} className="w-full sm:w-72" />
          {data && (
            <span className="text-sm text-ink-muted">
              <b className="text-ink">{formatQty(String(meta?.total ?? 0))}</b> {supplier ? "vendor POs" : "order lines"} ·{" "}
              <b className="text-ink">{formatQty(data.totals.qty)}</b> pcs · <b className="text-ink">{totalValue}</b>
            </span>
          )}
        </div>

        {error ? (
          <Alert title="Could not load the list">{error.message}</Alert>
        ) : !data && loading ? (
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card"><TableSkeleton rows={10} columns={columns} /></div>
        ) : !data || rows.length === 0 ? (
          <div className="rounded-lg border border-line bg-white py-12">
            <EmptyState title="Nothing to show" description={q ? "No row matches your search." : "No rows make up this figure."} />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-neutral-50/75 text-2xs uppercase tracking-wider text-ink-muted">
                    {supplier && th("Vendor PO", "number")}
                    {supplier && th("Vendor", "vendor")}
                    {th("Part", "part_number")}
                    {th("PO & Line", "po_number")}
                    {th("Ship date", "ship_date")}
                    {lines && th("File", "file")}
                    {lines && th("Status", "status")}
                    {th(lines ? config.qtyLabel : "Qty", "qty", "right")}
                    {th(supplier ? "Price / pc" : "Price / 100", "price", "right")}
                    {th("Revenue", "value", "right")}
                    {supplier && th("Price from", "price_source")}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {loading ? <SkeletonRows columns={columns} /> : rows.map((r, i) => {
                    const order = orderOf(r);
                    return (
                      <tr key={`${r.id ?? "x"}-${r.manual ? "m" : "r"}-${i}`} onClick={() => order && onOpenOrder(order)}
                          className={order ? "cursor-pointer transition-colors hover:bg-neutral-50/80" : ""}>
                        {supplier && <td className="max-w-40 break-words px-3 py-2.5 text-xs font-medium text-ink">{r.number}</td>}
                        {supplier && <td className="max-w-36 truncate px-3 py-2.5 text-xs text-ink" title={r.vendor ?? undefined}>{r.vendor}</td>}
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <PartThumbnail imageUrl={r.image_url} images={r.images} alt={r.part_number ?? "Part"} size="sm" />
                            <span className="min-w-0">
                              {r.part_number
                                ? <RelatedLink kind="part" value={r.part_number}><span className="block font-semibold text-ink hover:text-accent">{r.part_number}</span></RelatedLink>
                                : <span className="block text-ink-faint">No part</span>}
                              {r.description && <span className="block max-w-44 truncate text-xs text-ink-muted" title={r.description}>{r.description}</span>}
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          {r.po_number ? <RelatedLink kind="po" value={r.po_number}><span className="font-medium text-ink hover:text-accent">{r.po_number}</span></RelatedLink> : "—"}
                          {r.po_line_number && <span className="text-ink-muted">/{r.po_line_number}</span>}
                          {r.order_type && <span className="block text-2xs text-ink-muted">{r.order_type}{r.manual ? " · Manual" : ""}{r.business ? ` · ${r.business.toUpperCase()}` : ""}</span>}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-ink">{r.ship_date ? formatDate(r.ship_date) : "—"}</td>
                        {lines && <td className="whitespace-nowrap px-3 py-2.5 text-xs" title={r.file_name ?? undefined}>
                          <span className={r.kept ? "font-medium text-amber-700" : "text-ink-muted"}>{r.file}</span>
                        </td>}
                        {lines && <td className="whitespace-nowrap px-3 py-2.5"><StatusPill kind={r.status ?? "none"} /></td>}
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-medium text-ink">{formatQty(r.qty)}</td>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-xs text-ink-muted">
                          {r.price === null ? "—" : money(r.price, supplier ? r.currency : currency)}
                        </td>

                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-semibold text-ink">
                          {r.value === null ? <span className="text-xs font-normal text-amber-700">No price</span> : money(r.value, supplier ? r.currency : currency)}
                        </td>
                        {supplier && <td className={`max-w-40 truncate px-3 py-2.5 text-xs ${r.price_source?.startsWith("Other vendor") || r.price_source === "No price" ? "font-medium text-amber-700" : "text-ink-muted"}`}
                                         title={r.price_source}>{r.price_source}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {meta && meta.total_pages > 1 && (
              <footer className="flex items-center justify-between border-t border-line bg-neutral-50 px-4 py-3 text-xs text-ink-muted">
                <span>{formatQty(String(meta.from))}–{formatQty(String(meta.to))} of <b className="text-ink">{formatQty(String(meta.total))}</b> · page <b className="text-ink">{meta.page}</b> of <b className="text-ink">{meta.total_pages}</b></span>
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
