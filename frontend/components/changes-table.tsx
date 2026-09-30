"use client";

import { useState } from "react";
import type { Paginated, QuantityChange } from "@/lib/types";
import { formatCount, formatDate, formatDifference, formatQty } from "@/lib/format";
import { AGE_FILTER, AgeLegend, ageRowProps, todayParam } from "./age";
import { useApi, useDebounced } from "./use-api";
import { useListQuery } from "./use-list-query";
import { ChangeArrow } from "./direction";
import { CheckIcon } from "./icons";
import { Button } from "./ui/button";
import { ListToolbar } from "./ui/list-toolbar";
import { SearchInput } from "./ui/search-input";
import { Alert, EmptyState } from "./ui/feedback";
import { FilterChips, FilterMenu, type FilterGroup } from "./ui/filter-menu";
import { TableSkeleton } from "./ui/skeleton";
import { Pagination, Table, Td, Th } from "./ui/table";

const FILTERS: FilterGroup[] = [
  { key: "sort", label: "Sort by", defaultValue: "ship_date", options: [
    { value: "ship_date", label: "Ship date" }, { value: "po", label: "PO" },
    { value: "part", label: "Part number" }, { value: "difference", label: "Largest change" },
  ] },
  { key: "direction", label: "Change", options: [{ value: "increase", label: "↑ Quantity up" }, { value: "decrease", label: "↓ Quantity down" }] },
  { key: "type", label: "Type", options: [{ value: "Order", label: "Order" }, { value: "Firm", label: "Firm" }, { value: "Forecast", label: "Forecast" }] },
  AGE_FILTER,
];

export function ChangesTable({ uploadId, emptyDescription }: { uploadId: number; emptyDescription?: string }) {
  const list = useListQuery();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());

  const { data, error, loading } = useApi<Paginated<QuantityChange>>(`/api/uploads/${uploadId}/changes`, {
    q, ...list.filters, today: todayParam(), page: list.page, per_page: list.perPage,
  });
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };
  const [today] = useState(() => new Date());

  return (
    <div>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} change${data.meta.total === 1 ? "" : "s"}` : ""}>
        <SearchInput label="Search changes" placeholder="Search PO, part number or commodity" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
        <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
      </ListToolbar>
      <FilterChips groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
      <AgeLegend />

      {error ? (
        <div className="p-4"><Alert title="Could not load changes">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={8} columns={10} />
      ) : data && data.data.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No changes match these filters"
            description="Clear the search or filters to see all changes."
            action={<Button size="sm" onClick={clearAll}>Clear search and filters</Button>}
          />
        ) : (
          <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
            <CheckIcon size={32} className="text-neutral-300 mb-3" />
            <p className="text-sm font-semibold text-neutral-900">No quantity changes</p>
            {emptyDescription && <p className="text-xs text-neutral-400 mt-1 max-w-xs">{emptyDescription}</p>}
          </div>
        )
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table dense>
            <thead>
              <tr>
                <Th>PO</Th>
                <Th>PO Line</Th>
                <Th>Part Number</Th>
                <Th>Commodity Type</Th>
                <Th>Type</Th>
                <Th>Ship Date</Th>
                <Th align="right">Old Qty</Th>
                <Th align="right">New Qty</Th>
                <Th align="right">Difference</Th>
                <Th align="center">Change</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id} {...ageRowProps(c.ship_date, today, "hover:bg-canvas")}>
                  <Td className="font-medium">{c.po_number}</Td>
                  <Td className="text-ink-muted">{c.po_line_number}</Td>
                  <Td>{c.part_number}</Td>
                  <Td className="text-ink-muted">{c.commodity_type ?? "—"}</Td>
                  <Td>{c.order_type}</Td>
                  <Td className="tabular">{formatDate(c.ship_date)}</Td>
                  <Td align="right" className="text-ink-muted">{formatQty(c.old_qty)}</Td>
                  <Td align="right">{formatQty(c.new_qty)}</Td>
                  <Td align="right">
                    <span className={`font-semibold ${c.direction === "increase" ? "text-inc" : "text-dec"}`}>{formatDifference(c.difference)}</span>
                  </Td>
                  <Td align="center"><ChangeArrow direction={c.direction} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="changes" />
        </div>
      ) : null}
    </div>
  );
}
