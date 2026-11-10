"use client";

import { useState } from "react";
import type { AllChangesPage, AnyChange, ChangeKind } from "@/lib/types";
import { formatCount, formatDate, formatDifference, formatQty } from "@/lib/format";
import { AGE_FILTER, todayParam } from "./age";
import { RelatedLink } from "./orders/related-popover";
import { useApi, useDebounced } from "./use-api";
import { useListQuery } from "./use-list-query";
import { CheckIcon } from "./icons";
import { Button } from "./ui/button";
import { ListToolbar } from "./ui/list-toolbar";
import { SearchInput } from "./ui/search-input";
import { Alert, EmptyState } from "./ui/feedback";
import { FilterChips, FilterMenu, type FilterGroup } from "./ui/filter-menu";
import { TableSkeleton } from "./ui/skeleton";
import { Pagination, Table, Td, Th } from "./ui/table";

const dash = <span className="text-neutral-300">—</span>;

// Each type of change: its label in the Change column and filter, and its colour.
const KINDS: Record<ChangeKind, { label: string; tone: string }> = {
  increase: { label: "↑ Qty up", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  decrease: { label: "↓ Qty down", tone: "border-red-200 bg-red-50 text-red-700" },
  added: { label: "+ Row added", tone: "border-sky-200 bg-sky-50 text-sky-700" },
  removed: { label: "− Row removed", tone: "border-neutral-300 bg-neutral-100 text-neutral-600" },
  rescheduled: { label: "Date moved", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  address: { label: "Address", tone: "border-violet-200 bg-violet-50 text-violet-700" },
};
// The changed value, as on Compare versions: old red and struck through, new green.
const OLD_MARK = "rounded bg-red-100 px-1.5 py-0.5 text-red-800 line-through decoration-red-400/70";
const NEW_MARK = "rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800";
const KIND_ORDER: ChangeKind[] = ["increase", "decrease", "added", "removed", "rescheduled", "address"];

const FILTERS: FilterGroup[] = [
  { key: "sort", label: "Sort by", defaultValue: "ship_date", options: [
    { value: "ship_date", label: "Ship date" }, { value: "po", label: "PO" },
    { value: "part", label: "Part number" }, { value: "difference", label: "Largest change" },
  ] },
  { key: "direction", label: "Change", options: KIND_ORDER.map((k) => ({ value: k, label: KINDS[k].label })) },
  { key: "type", label: "Type", options: [{ value: "Order", label: "Order" }, { value: "Firm", label: "Firm" }, { value: "Forecast", label: "Forecast" }] },
  AGE_FILTER,
];

// The old and new value of a change: the Qty, the Ship Date (date moved) or the Ship To Address.
function values(c: AnyChange) {
  if (c.direction === "address") return { old: c.old_address, new: c.new_address, wide: true };
  if (c.direction === "rescheduled") return { old: formatDate(c.previous_ship_date), new: formatDate(c.ship_date), wide: false };
  return { old: formatQty(c.old_qty), new: formatQty(c.new_qty), wide: false };
}

// Changes tab of the Orders page: every change of the upload in one table (Qty up / down, rows added / removed, Ship
// Dates moved and Ship To Address changes): Change, Difference, Old and New first, then the order line.
// `manual`: also the changes from manual order edits since this (latest) upload. `direction`: start filtered on one
// type of change (e.g. from a summary card).
export function AllChangesTable({ uploadId, manual = false, direction }: { uploadId: number; manual?: boolean; direction?: string }) {
  const list = useListQuery(direction ? { direction } : {});
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi<AllChangesPage>(`/api/uploads/${uploadId}/all_changes`, {
    q, ...list.filters, today: todayParam(), page: list.page, per_page: list.perPage, manual: manual ? 1 : undefined,
  });
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };
  const link = manual ? undefined : uploadId;
  const counts = data ? KIND_ORDER.filter((k) => (data.meta.counts[k] ?? 0) > 0) : [];

  return (
    <div>
      <ListToolbar wrap summary={data ? (
        <>
          {formatCount(data.meta.total)} change{data.meta.total === 1 ? "" : "s"}
          {counts.length > 0 && <> · {counts.map((k) => `${formatCount(data.meta.counts[k] ?? 0)} ${KINDS[k].label.replace(/^[↑↓+−] /, "").toLowerCase()}`).join(" · ")}</>}
          {Number(data.meta.net) !== 0 && <> · net {formatDifference(data.meta.net)}</>}
        </>
      ) : ""}>
        <SearchInput label="Search changes" placeholder="Search PO, part number, description, commodity or address" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-80" />
        <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
      </ListToolbar>
      <FilterChips groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />

      {error ? (
        <div className="p-4"><Alert title="Could not load changes">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={8} columns={9} />
      ) : data && data.data.length === 0 ? (
        filtered ? (
          <EmptyState title="No changes match these filters" description="Clear the search or filters to see all changes."
                      action={<Button size="sm" onClick={clearAll}>Clear search and filters</Button>} />
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <CheckIcon size={32} className="mb-3 text-neutral-300" />
            <p className="text-sm font-semibold text-neutral-900">No changes</p>
            <p className="mt-1 max-w-xs text-xs text-neutral-400">Every order row present in both the previous and the latest upload is the same.</p>
          </div>
        )
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table dense stickyHeader>
            <thead>
              <tr>
                <Th>Change</Th>
                <Th align="right">Difference</Th>
                <Th>Old</Th>
                <Th>New</Th>
                <Th>PO</Th>
                <Th>Part Number</Th>
                <Th>Part Description</Th>
                <Th>Type</Th>
                <Th>Ship Date</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => {
                const v = values(c);
                const quantity = c.direction !== "address";
                return (
                  <tr key={`${quantity ? "q" : "a"}-${c.id}`} className="transition-colors hover:bg-canvas">
                    <Td>
                      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${KINDS[c.direction].tone}`}>
                        {KINDS[c.direction].label}
                      </span>
                    </Td>
                    <Td align="right">
                      {quantity && c.direction !== "rescheduled" ? (
                        <span className={`font-semibold tabular ${Number(c.difference) > 0 ? "text-inc" : Number(c.difference) < 0 ? "text-dec" : "text-ink-muted"}`}>
                          {formatDifference(c.difference)}
                        </span>
                      ) : dash}
                    </Td>
                    {/* A row added had no old value, a row removed has no new one: only the other side is marked. */}
                    <Td className={v.wide ? "" : "tabular"}>
                      <span className={`${v.wide ? "inline-block max-w-56 whitespace-normal break-words leading-snug" : "whitespace-nowrap"} ${
                        c.direction === "added" ? "text-ink-muted" : OLD_MARK}`}>{v.old ?? "—"}</span>
                    </Td>
                    <Td className={v.wide ? "" : "tabular"}>
                      <span className={`${v.wide ? "inline-block max-w-56 whitespace-normal break-words leading-snug" : "whitespace-nowrap"} ${
                        c.direction === "removed" ? "text-ink-muted" : NEW_MARK}`}>{v.new ?? "—"}</span>
                    </Td>
                    <Td><RelatedLink kind="po" value={c.po_number} uploadId={link} /></Td>
                    <Td><RelatedLink kind="part" value={c.part_number} uploadId={link} /></Td>
                    <Td><span className="block w-64 whitespace-normal break-words py-1 leading-snug">{c.part_description || "—"}</span></Td>
                    <Td>
                      {/* The row's Type changed between the two uploads (e.g. a Forecast date became Firm): show both. */}
                      {"previous_order_type" in c && c.previous_order_type && c.previous_order_type !== c.order_type ? (
                        <span className="whitespace-nowrap" title={`${c.previous_order_type} in the previous upload, ${c.order_type} in this one`}>
                          <span className={OLD_MARK}>{c.previous_order_type}</span> → <span className={NEW_MARK}>{c.order_type}</span>
                        </span>
                      ) : c.order_type}
                    </Td>
                    <Td className="tabular">
                      {/* A moved date is the field that changed: green here too. */}
                      <span className={c.direction === "rescheduled" ? NEW_MARK : ""}>{formatDate(c.ship_date)}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="changes" />
        </div>
      ) : null}
    </div>
  );
}
