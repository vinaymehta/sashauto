"use client";

import { useState } from "react";
import type { SnapshotRowsPage } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { useApi, useDebounced } from "./use-api";
import { useListQuery } from "./use-list-query";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ListToolbar } from "./ui/list-toolbar";
import { SearchInput } from "./ui/search-input";
import { Alert, EmptyState } from "./ui/feedback";
import { FilterChips, FilterMenu, type FilterGroup } from "./ui/filter-menu";
import { TableSkeleton } from "./ui/skeleton";
import { Pagination, Table, Td, Th } from "./ui/table";

// The stored order rows of one version: what the uploaded workbook contained after
// normalization (one row per order key; merged duplicates list all their Excel rows).
export function RowsTable({ uploadId }: { uploadId: number }) {
  const list = useListQuery();
  const [search, setSearch] = useState("");
  const [shipTos, setShipTos] = useState<string[]>([]);
  const q = useDebounced(search.trim());

  const { data, error, loading } = useApi<SnapshotRowsPage>(`/api/uploads/${uploadId}/rows`, {
    q, ...list.filters, page: list.page, per_page: list.perPage,
  });
  if (data && data.ship_to_locations.join() !== shipTos.join()) setShipTos(data.ship_to_locations);

  const filters: FilterGroup[] = [
    { key: "sort", label: "Sort by", defaultValue: "excel_row", options: [
      { value: "excel_row", label: "Excel row" }, { value: "ship_date", label: "Ship date" },
      { value: "po", label: "PO" }, { value: "part", label: "Part number" },
    ] },
    { key: "type", label: "Type", options: [{ value: "Order", label: "Order" }, { value: "Firm", label: "Firm" }, { value: "Forecast", label: "Forecast" }] },
    { key: "quantity", label: "Quantity taken from", options: [
      { value: "qty", label: "Qty" }, { value: "previous_qty", label: "Previous Qty (Qty blank)" }, { value: "unknown", label: "Unknown (both blank)" },
    ] },
    ...(shipTos.length > 1 ? [{ key: "ship_to", label: "Ship To Location", options: shipTos.map((s) => ({ value: s, label: s })) }] : []),
  ];
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);

  return (
    <div>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} row${data.meta.total === 1 ? "" : "s"}` : ""}>
        <SearchInput label="Search rows" placeholder="Search PO, part number or commodity" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
        <FilterMenu groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
      </ListToolbar>
      <FilterChips groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />

      {error ? (
        <div className="p-4"><Alert title="Could not load the rows">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={10} columns={9} />
      ) : data && data.data.length === 0 ? (
        <EmptyState title={filtered ? "No rows match" : "No rows"} description={filtered ? "Clear the search or filters to see all rows." : undefined}
                    action={filtered ? <Button size="sm" onClick={() => { list.clearFilters(); setSearch(""); }}>Clear search and filters</Button> : undefined} />
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table dense>
            <thead>
              <tr>
                <Th align="right">Excel Row</Th>
                <Th>Type</Th>
                <Th>PO / Line</Th>
                <Th>Part Number</Th>
                <Th>Commodity Type</Th>
                <Th>Ship Date</Th>
                <Th>Ship To</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Previous Qty</Th>
                <Th align="right">Compared Qty</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-canvas">
                  <Td align="right" className="text-ink-muted" title={r.source_row_numbers.length > 1 ? "Duplicate rows merged into one order row" : undefined}>
                    {r.source_row_numbers.join(", ")}
                  </Td>
                  <Td>{r.order_type}</Td>
                  <Td><span className="font-medium">{r.po_number}</span><span className="text-ink-faint"> / {r.po_line_number}</span></Td>
                  <Td>{r.part_number}</Td>
                  <Td className="text-ink-muted">{r.commodity_type ?? "—"}</Td>
                  <Td className="tabular">{formatDate(r.ship_date)}</Td>
                  <Td className="text-ink-muted">{r.ship_to_location}</Td>
                  <Td align="right">{formatQty(r.qty)}</Td>
                  <Td align="right" className="text-ink-muted">{formatQty(r.previous_qty)}</Td>
                  <Td align="right">
                    {r.quantity_source === "unknown"
                      ? <Badge tone="neutral">Unknown</Badge>
                      : <span className="inline-flex items-center gap-1.5">
                          {r.quantity_source === "previous_qty" && (
                            <span title="Qty is blank, so Previous Qty is used" className="rounded border border-line bg-subtle px-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">Prev</span>
                          )}
                          <span className="font-semibold">{formatQty(r.effective_qty)}</span>
                        </span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="rows" />
        </div>
      ) : null}
    </div>
  );
}
