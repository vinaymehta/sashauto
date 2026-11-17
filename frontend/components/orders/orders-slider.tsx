"use client";

import { useState, type ReactNode } from "react";
import type { DashboardOrder, OrderRow, OrdersPage, OrderStatus } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { todayParam } from "@/components/age";
import { useApi, useDebounced } from "@/components/use-api";
import { Sheet } from "@/components/ui/sheet";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, Spinner } from "@/components/ui/feedback";
import { StatusPill } from "@/components/orders/delivery-cell";
import { RelatedLink } from "@/components/orders/related-popover";
import { PartThumbnail } from "@/components/products/part-thumbnail";
import { SortTh, type SortDirection } from "@/components/ui/sort-header";
import { FileIcon } from "@/components/icons";
import Link from "next/link";

export interface OrdersSliderConfig {
  title: string;
  description?: string;
  filters: Record<string, string | number | undefined>;
  icon?: ReactNode;
}

interface OrdersSliderProps {
  config: OrdersSliderConfig | null;
  onClose: () => void;
  onOpenOrder: (order: DashboardOrder | OrderRow) => void;
}

const pricePerPiece = (r: OrderRow) => {
  const raw = r.source_data?.["Unit Price"];
  const n = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isNaN(n)
    ? "—"
    : `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
};

export function OrdersSlider({ config, onClose, onOpenOrder }: OrdersSliderProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim());
  const [sort, setSort] = useState<string>("ship_date");
  const [direction, setDirection] = useState<SortDirection>("asc");

  const toggleSort = (key: string) => {
    if (sort === key) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDirection(key === "qty" || key === "unit_price" ? "desc" : "asc");
    }
    setPage(1);
  };

  const today = todayParam();

  // Reset page when search or filters change
  const queryParams = {
    ...config?.filters,
    // The Dashboard's orders only (its cards leave out GMBH 45… POs and excluded parts), so the list matches the card.
    dashboard: 1,
    today,
    q: debouncedSearch || undefined,
    sort,
    direction,
    page,
    per_page: 50,
  };

  const { data, error, loading } = useApi<OrdersPage>(
    config ? "/api/orders" : null,
    queryParams
  );

  const orders = data?.data ?? [];
  const meta = data?.meta;
  const total = meta?.total ?? 0;
  const pages = meta?.total_pages ?? 1;

  // Sorted by the server over all matching orders (then paged): re-sorting a page here would mix two orders.
  const sortedOrders = orders;

  if (!config) return null;

  // Build link to full orders page with current filters
  const fullPageParams = new URLSearchParams();
  Object.entries(config.filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") fullPageParams.set(k, String(v));
  });
  if (debouncedSearch) fullPageParams.set("q", debouncedSearch);
  if (sort) fullPageParams.set("sort", sort);
  if (direction) fullPageParams.set("direction", direction);
  const fullPageHref = `/orders?${fullPageParams.toString()}`;

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={config.title}
      description={config.description}
      icon={config.icon ?? <FileIcon size={18} />}
    >
      <div className="space-y-4">
        {/* Search & Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64">
              <SearchInput
                value={search}
                onSearch={(v: string) => {
                  setSearch(v);
                  setPage(1);
                }}
                label="Search orders"
                placeholder="Search in these orders…"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-medium text-ink-muted">Sort:</span>
              <select
                value={`${sort}:${direction}`}
                onChange={(e) => {
                  const [s, d] = e.target.value.split(":") as [string, SortDirection];
                  setSort(s);
                  setDirection(d);
                  setPage(1);
                }}
                className="h-8 rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink shadow-2xs hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-accent/40"
                aria-label="Sort orders"
              >
                <option value="ship_date:asc">Ship Date (Earliest first)</option>
                <option value="ship_date:desc">Ship Date (Latest first)</option>
                <option value="part_number:asc">Part Number (A → Z)</option>
                <option value="part_number:desc">Part Number (Z → A)</option>
                <option value="po_number:asc">PO Number (Lowest first)</option>
                <option value="po_number:desc">PO Number (Highest first)</option>
                <option value="qty:desc">Quantity (Highest first)</option>
                <option value="qty:asc">Quantity (Lowest first)</option>
                <option value="unit_price:desc">Price (Highest first)</option>
                <option value="unit_price:asc">Price (Lowest first)</option>
                <option value="status:asc">Status (A → Z)</option>
                <option value="status:desc">Status (Z → A)</option>
                <option value="vendor_po:desc">Vendor PO (PO generated first)</option>
                <option value="vendor_po:asc">Vendor PO (No PO first)</option>
                <option value="firm_date:asc">Effective Firm Date (Oldest first)</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
            {meta && (
              <span>
                Showing <b className="text-ink">{orders.length}</b> of{" "}
                <b className="text-ink">{total}</b> orders
              </span>
            )}
            <Link
              href={fullPageHref}
              className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              Open in Orders page →
            </Link>
          </div>
        </div>

        {/* Content */}
        {error ? (
          <Alert title="Could not load orders">{error.message}</Alert>
        ) : loading && !data ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-lg border border-line bg-white py-12">
            <EmptyState
              title="No orders found"
              description={
                debouncedSearch
                  ? "No orders match your search term."
                  : "There are no orders matching this filter."
              }
              action={
                debouncedSearch ? (
                  <Button size="sm" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-neutral-50/75 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                    <SortTh label="Part" sortKey="part_number" sort={sort} direction={direction} onSort={toggleSort} className="py-2.5 pl-4 pr-3" />
                    <SortTh label="PO & Line" sortKey="po_number" sort={sort} direction={direction} onSort={toggleSort} className="px-3 py-2.5" />
                    <SortTh label="Ship Date" sortKey="ship_date" sort={sort} direction={direction} onSort={toggleSort} className="px-3 py-2.5" />
                    <SortTh label="Qty" sortKey="qty" align="right" sort={sort} direction={direction} onSort={toggleSort} className="px-3 py-2.5" />
                    <SortTh label="Price" sortKey="unit_price" align="right" sort={sort} direction={direction} onSort={toggleSort} className="px-3 py-2.5" />
                    <SortTh label="Status" sortKey="status" sort={sort} direction={direction} onSort={toggleSort} className="px-3 py-2.5" />
                    <SortTh label="Vendor PO" sortKey="vendor_po" sort={sort} direction={direction} onSort={toggleSort} className="py-2.5 pl-3 pr-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {sortedOrders.map((r) => {
                    const overdue = r.ship_date < today;
                    return (
                      <tr
                        key={`${r.manual ? "m" : "r"}${r.id}`}
                        onClick={() => onOpenOrder(r)}
                        className="cursor-pointer transition-colors hover:bg-neutral-50/80"
                      >
                        {/* Part column with thumbnail */}
                        <td className="py-2.5 pl-4 pr-3">
                          <span className="flex items-center gap-2.5">
                            <PartThumbnail
                              imageUrl={r.image_url}
                              images={r.images}
                              alt={r.part_number}
                              size="sm"
                              showFallback
                            />
                            <span className="min-w-0">
                              <RelatedLink kind="part" value={r.part_number}>
                                <span className="block font-semibold text-ink hover:text-accent">
                                  {r.part_number}
                                </span>
                              </RelatedLink>
                              {r.part_description && (
                                <span
                                  className="block max-w-48 truncate text-xs text-ink-muted"
                                  title={r.part_description}
                                >
                                  {r.part_description}
                                </span>
                              )}
                            </span>
                          </span>
                        </td>

                        {/* PO Number / Line */}
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className="font-medium text-ink">
                            PO {r.po_number}/{r.po_line_number}
                          </span>
                          <span className="block text-2xs text-ink-muted">
                            {r.order_type}
                            {r.manual && " · Manual"}
                          </span>
                        </td>

                        {/* Ship Date */}
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span
                            className={`tabular block font-medium ${
                              overdue ? "text-age-red-ink font-semibold" : "text-ink"
                            }`}
                          >
                            {formatDate(r.ship_date)}
                          </span>
                          {overdue && (
                            <span className="block text-2xs font-semibold uppercase text-age-red-ink">
                              Overdue
                            </span>
                          )}
                        </td>

                        {/* Quantity */}
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-medium text-ink">
                          {formatQty(r.qty)} pcs
                        </td>

                        {/* Price */}
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-xs text-ink-muted">
                          {pricePerPiece(r)}
                        </td>

                        {/* Status */}
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <StatusPill kind={(r.status as OrderStatus) ?? "none"} />
                        </td>

                        {/* Vendor PO Badge */}
                        <td className="whitespace-nowrap py-2.5 pl-3 pr-4">
                          {r.order_placed ? (
                            <Badge tone="dark">Order placed</Badge>
                          ) : r.placed ? (
                            <Badge tone="up">PO generated</Badge>
                          ) : (
                            <Badge tone="warn">No vendor PO</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {pages > 1 && (
              <footer className="flex items-center justify-between border-t border-line bg-neutral-50 px-4 py-3 text-xs text-ink-muted">
                <span>
                  Page <b className="text-ink">{page}</b> of <b className="text-ink">{pages}</b>
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPage((p) => Math.max(1, p - 1));
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= pages}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPage((p) => Math.min(pages, p + 1));
                    }}
                  >
                    Next
                  </Button>
                </div>
              </footer>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
