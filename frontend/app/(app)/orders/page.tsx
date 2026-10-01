"use client";

import { useState, type ReactNode } from "react";
import type { OrderRow, OrdersPage } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { ChevronRightSmallIcon, DownloadIcon } from "@/components/icons";
import { cell, HistoryPanel } from "@/components/orders/history-row";
import { RelatedLink } from "@/components/orders/related-popover";
import { AGE_FILTER, AgeLegend, ageRowProps, todayParam } from "@/components/age";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader, Panel } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { FilterChips, FilterMenu, type FilterGroup } from "@/components/ui/filter-menu";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td } from "@/components/ui/table";

type Align = "left" | "right";
interface Column {
  key: string; // sort key accepted by GET /api/orders
  label: string;
  align?: Align;
  render: (row: OrderRow) => ReactNode;
}

const dash = <span className="text-neutral-300">—</span>;
const text = (value: string | null) => value ?? dash;
const date = (value: string | null) => (value ? formatDate(value) : dash);
const qty = (value: string | null) => (value === null ? dash : formatQty(value));

// Typed display for the columns the app models itself; every other Excel column shows its imported value.
const TYPED: Record<string, Omit<Column, "key" | "label">> = {
  type: { render: (r) => r.order_type },
  due_date: { render: (r) => date(r.due_date) },
  ship_date: { render: (r) => formatDate(r.ship_date) },
  unit: { render: (r) => <span className="block max-w-64 truncate" title={r.unit ?? undefined}>{text(r.unit)}</span> },
  po_number: { render: (r) => <RelatedLink kind="po" value={r.po_number} /> },
  part_number: { render: (r) => <RelatedLink kind="part" value={r.part_number} /> },
  qty: { align: "right", render: (r) => qty(r.qty) },
  previous_qty: { align: "right", render: (r) => qty(r.previous_qty) },
  last_asn_qty: { align: "right", render: (r) => qty(r.last_asn_qty) },
  last_receipt_qty: { align: "right", render: (r) => qty(r.last_receipt_qty) },
};

// All Excel columns of the upload, in file order (same as the history table).
function buildColumns(columns: { key: string; label: string }[], rows: OrderRow[]): Column[] {
  return columns.map(({ key, label }) => {
    const typed = TYPED[key];
    if (typed) return { key, label, ...typed };
    const numeric = rows.some((r) => typeof r.source_data?.[label] === "number");
    return {
      key, label, align: numeric ? "right" : "left",
      render: (r) => <span className="block max-w-72 truncate" title={String(r.source_data?.[label] ?? "")}>{cell(r.source_data?.[label])}</span>,
    };
  });
}

export default function OrdersPage() {
  const list = useListQuery({}, 50, { key: "ship_date", direction: "asc" });
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());

  const { data, error, loading } = useApi<OrdersPage>("/api/orders", {
    search: term, ...list.filters, today: todayParam(), sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });

  // Keep the last known option lists so the panel does not empty while a filtered page loads.
  const [facets, setFacets] = useState<OrdersPage["facets"]>(null);
  if (data?.facets && data.facets !== facets) setFacets(data.facets);
  const filters: FilterGroup[] = [
    { key: "type", label: "Type", options: [{ value: "Order", label: "Order" }, { value: "Firm", label: "Firm" }, { value: "Forecast", label: "Forecast" }] },
    { key: "ship_to", label: "Ship To Location", options: (facets?.ship_to_locations ?? []).map((v) => ({ value: v, label: v })) },
    { key: "ship_date", label: "Ship date", type: "date-range", options: [] },
    { key: "commodity_type", label: "Commodity Type", options: (facets?.commodity_types ?? []).map((v) => ({ value: v, label: v })) },
    AGE_FILTER,
  ];
  const filtered = term !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };

  // Keep the last known column list so the header does not vanish while a page loads.
  const [sourceColumns, setSourceColumns] = useState<NonNullable<OrdersPage["columns"]>>([]);
  if (data?.columns && data.columns !== sourceColumns) setSourceColumns(data.columns);
  const COLUMNS = buildColumns(sourceColumns, data?.data ?? []);

  const source = data?.source;
  // Row whose history is open in the side panel.
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [today] = useState(() => new Date());

  return (
    <>
      <PageHeader
        title="Orders"
        actions={source && (
          <div className="flex items-center gap-2">
            <a href={`/api/uploads/${source.upload_id}/download`} download>
              <Button><DownloadIcon size={15} className="text-ink-muted" />Download .xlsx</Button>
            </a>
          </div>
        )}
      />

      <Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} order row${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search orders" placeholder="Search PO, part, commodity, type, location…" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-80" />
          <FilterMenu groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        <AgeLegend />

        {error ? (
          <div className="p-4"><Alert title="Could not load orders">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={10} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No order rows match" : "No order data yet"}
            description={filtered ? "Try a different search or clear the filters." : "Upload a Supplier Requirements export on Upload / Detection."}
            action={filtered ? <Button size="sm" onClick={clearAll}>Clear search and filters</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            <Table dense>
              <thead>
                <tr>
                  <th aria-label="History" className="h-10 w-10 border-b border-neutral-200 bg-neutral-50" />
                  {COLUMNS.map((c) => (
                    <SortTh key={c.key} label={c.label} sortKey={c.key} align={c.align ?? "left"}
                            sort={list.sort} direction={list.direction} onSort={list.toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => {
                  const open = selected?.id === row.id;
                  const tint = ageRowProps(row.ship_date, today);
                  const history = row.history_count ?? 0;
                  return (
                      <tr key={row.id} className={`cursor-pointer ${tint.className} ${open ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`} title={tint.title}
                          onClick={() => setSelected(row)} aria-haspopup="dialog" aria-expanded={open}>
                        <Td className="w-10 pr-0! text-ink-muted">
                          <span className="inline-flex items-center gap-1">
                            <ChevronRightSmallIcon size={14} className={open ? "text-accent" : ""} />
                            {history > 0 && <span className="tabular rounded bg-neutral-100 px-1 text-2xs font-semibold text-neutral-600" title={`${history} earlier row${history === 1 ? "" : "s"}`}>{history}</span>}
                          </span>
                        </Td>
                        {COLUMNS.map((c) => (
                          <Td key={c.key} align={c.align === "right" ? "right" : "left"}>{c.render(row)}</Td>
                        ))}
                      </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="order rows" />
          </div>
        ) : null}
        {selected && <HistoryPanel key={selected.id} row={selected} today={today} onClose={() => setSelected(null)} />}
      </Panel>
    </>
  );
}
