"use client";

import { useState } from "react";
import type { UploadChoice, VersionDiffPage } from "@/lib/types";
import { formatCount, formatDate, formatDateTime, formatDifference, formatQty } from "@/lib/format";
import { RelatedLink } from "./orders/related-popover";
import { useApi, useDebounced } from "./use-api";
import { useListQuery } from "./use-list-query";
import { ChangeArrow } from "./direction";
import { Button } from "./ui/button";
import { ListToolbar } from "./ui/list-toolbar";
import { SearchInput } from "./ui/search-input";
import { Alert, EmptyState } from "./ui/feedback";
import { Select } from "./ui/field";
import { FilterChips, FilterMenu, type FilterGroup } from "./ui/filter-menu";
import { TableSkeleton } from "./ui/skeleton";
import { Pagination, Table, Td, Th } from "./ui/table";

const FILTERS: FilterGroup[] = [
  { key: "direction", label: "Change", options: [
    { value: "increase", label: "↑ Quantity up" }, { value: "decrease", label: "↓ Quantity down" },
    { value: "added", label: "Row added" }, { value: "removed", label: "Row removed" },
    { value: "rescheduled", label: "Rescheduled (moved date)" },
    { value: "changed", label: "Other field changed (Type, Due Date, Ship To)" },
  ] },
];

// Toolbar summary words for meta.counts, in this order.
const COUNT_LABELS = [
  ["increase", "up"], ["decrease", "down"], ["added", "added"], ["removed", "removed"], ["rescheduled", "moved"], ["changed", "other"],
] as const;

// Comparison tab of the Orders page: pick two versions (uploads) of the shown business, then Compare lists the lines that
// differ. `uploads`: the business's completed uploads, newest first; From starts on the second newest, To on the newest.
// The list stays on the compared versions until Compare is clicked again.
export function ComparisonTable({ uploads }: { uploads: UploadChoice[] }) {
  const list = useListQuery();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  // A picked id that is no longer listed (e.g. after switching business) falls back to the default.
  const [picked, setPicked] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });
  const listed = (id: number | null) => id !== null && uploads.some((u) => u.id === id);
  const from = listed(picked.from) ? picked.from : uploads[1]?.id ?? null;
  const to = listed(picked.to) ? picked.to : uploads[0]?.id ?? null;
  const comparable = from !== null && to !== null && from !== to;
  // The versions last compared (Compare); none until it is clicked, or when one is no longer listed.
  const [compared, setCompared] = useState<{ from: number; to: number } | null>(null);
  const shown = compared && listed(compared.from) && listed(compared.to) ? compared : null;
  const current = shown !== null && shown.from === from && shown.to === to;

  const { data, error, loading } = useApi<VersionDiffPage>(shown ? "/api/uploads/compare" : null, {
    from: shown?.from, to: shown?.to, q, direction: list.filters.direction, page: list.page, per_page: list.perPage,
  });
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };
  const pick = (key: "from" | "to", id: string) => setPicked((p) => ({ ...p, [key]: Number(id) }));
  const compare = () => { if (comparable) { setCompared({ from, to }); list.resetPage(); } };

  if (uploads.length < 2) {
    return <EmptyState title="Two versions are needed to compare" description="Upload another file of this business to see what changed between them." />;
  }

  const counts = data ? COUNT_LABELS.filter(([key]) => (data.meta.counts[key] ?? 0) > 0) : [];

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4 sm:px-6">
        {([["from", "From version", from], ["to", "To version", to]] as const).map(([key, label, value]) => (
          <div key={key} className="w-full space-y-1.5 sm:w-auto">
            <label htmlFor={`compare-${key}`} className="text-sm font-medium text-ink">{label}</label>
            <Select id={`compare-${key}`} className="block w-full sm:w-96" value={value ?? ""} onChange={(e) => pick(key, e.target.value)}>
              {uploads.map((u) => (
                <option key={u.id} value={u.id}>{u.original_filename} · {formatDateTime(u.completed_at)}</option>
              ))}
            </Select>
          </div>
        ))}
        <Button variant="primary" onClick={compare} disabled={!comparable || current}>Compare</Button>
      </div>

      {!comparable ? (
        <div className="p-4"><Alert tone="info">Choose two different versions.</Alert></div>
      ) : !shown ? (
        <EmptyState title="Choose two versions" description="Pick the From and To versions, then click Compare." />
      ) : (
        <>
          <ListToolbar summary={data ? (
            <>
              {formatCount(data.meta.total)} line{data.meta.total === 1 ? "" : "s"}
              {counts.length > 0 && <> · {counts.map(([key, word]) => `${formatCount(data.meta.counts[key])} ${word}`).join(" · ")}</>}
            </>
          ) : ""}>
            <SearchInput label="Search differences" placeholder="Search PO, part number or description" value={search}
                         onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
            <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
          </ListToolbar>
          <FilterChips groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />

          {error ? (
            <div className="p-4"><Alert title="Could not load the comparison">{error.message}</Alert></div>
          ) : loading && !data ? (
            <TableSkeleton rows={8} columns={11} />
          ) : data && data.data.length === 0 ? (
            filtered ? (
              <EmptyState
                title="No differences match these filters"
                description="Clear the search or filters to see all differences."
                action={<Button size="sm" onClick={clearAll}>Clear search and filters</Button>}
              />
            ) : (
              <EmptyState title="No differences" description="These two versions have the same order lines." />
            )
          ) : data ? (
            <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
              <Table dense stickyHeader>
                <thead>
                  <tr>
                    <Th>PO</Th>
                    <Th>PO Line</Th>
                    <Th>Part Number</Th>
                    <Th>Part Description</Th>
                    <Th>Type</Th>
                    <Th>Ship Date</Th>
                    <Th align="right">Old Qty</Th>
                    <Th align="right">New Qty</Th>
                    <Th align="right">Difference</Th>
                    <Th align="center">Change</Th>
                    <Th>Other changes</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((l) => (
                    <tr key={`${l.po_number}|${l.po_line_number}|${l.part_number}|${l.ship_date}|${l.direction}`} className="hover:bg-canvas">
                      <Td className="font-medium">{l.po_number}</Td>
                      <Td className="text-ink-muted">{l.po_line_number}</Td>
                      <Td><RelatedLink kind="part" value={l.part_number} uploadId={shown?.to} /></Td>
                      <Td><span className="block w-72 whitespace-normal break-words py-1 leading-snug">{l.part_description || "—"}</span></Td>
                      <Td>{l.order_type}</Td>
                      <Td className="tabular">
                        {l.previous_ship_date ? <><span className="text-ink-muted">{formatDate(l.previous_ship_date)} →</span> {formatDate(l.ship_date)}</> : formatDate(l.ship_date)}
                      </Td>
                      <Td align="right" className="text-ink-muted">{formatQty(l.old_qty)}</Td>
                      <Td align="right">{formatQty(l.new_qty)}</Td>
                      <Td align="right">
                        <span className={`font-semibold ${Number(l.difference) > 0 ? "text-inc" : Number(l.difference) < 0 ? "text-dec" : "text-ink-muted"}`}>{formatDifference(l.difference)}</span>
                      </Td>
                      <Td align="center">
                        {l.direction === "changed"
                          ? <span className="text-xs font-semibold text-ink-muted">Changed</span>
                          : <ChangeArrow direction={l.direction} difference={l.difference} />}
                      </Td>
                      <Td className="text-xs text-ink-muted">
                        {l.fields.length === 0 ? "—" : l.fields.map((f) => (
                          <span key={f.label} className="block">{f.label}: {f.old ?? "—"} → {f.new ?? "—"}</span>
                        ))}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="lines" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
