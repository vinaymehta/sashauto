"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Paginated, UploadSummary } from "@/lib/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { UploadStatusBadge } from "@/components/upload-status";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { FilterChips, FilterMenu, type FilterGroup } from "@/components/ui/filter-menu";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { SearchInput } from "@/components/ui/search-input";
import { PageHeader, Panel } from "@/components/ui/panel";
import { TableSkeleton } from "@/components/ui/skeleton";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td } from "@/components/ui/table";

const FILTERS: FilterGroup[] = [
  { key: "status", label: "Processing status", options: [
    { value: "completed", label: "Completed" }, { value: "failed", label: "Failed" },
    { value: "processing", label: "Processing" }, { value: "pending", label: "Queued" },
  ] },
];

export default function UploadHistoryPage() {
  const router = useRouter();
  const list = useListQuery({}, 10, { key: "uploaded_at", direction: "desc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi<Paginated<UploadSummary>>("/api/uploads", {
    q, ...list.filters, sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);
  const sortProps = { sort: list.sort, direction: list.direction, onSort: list.toggleSort };

  return (
    <>
      <PageHeader title="Upload History" description="Every uploaded file is kept, including rejected ones, and completed uploads never change." />
      <Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} upload${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search uploads" placeholder="Search file name or uploader" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        {error ? (
          <div className="p-4"><Alert title="Could not load uploads">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={8} columns={7} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No uploads match" : "No uploads yet"}
            action={filtered
              ? <Button size="sm" onClick={() => { list.clearFilters(); setSearch(""); }}>Clear search and filters</Button>
              : <Link href="/detect" className="text-base underline">Upload the first file</Link>}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            <Table fixed>
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr>
                  <SortTh label="Uploaded At" sortKey="uploaded_at" {...sortProps} />
                  <SortTh label="Original File Name" sortKey="original_filename" {...sortProps} />
                  <SortTh label="Uploaded By" sortKey="uploaded_by" {...sortProps} />
                  <SortTh label="Row Count" sortKey="row_count" align="right" {...sortProps} />
                  <SortTh label="Changes" sortKey="changes" align="right" {...sortProps} />
                  <SortTh label="Status" sortKey="status" align="right" {...sortProps} />
                </tr>
              </thead>
              <tbody>
                {data.data.map((u) => (
                  <tr key={u.id} onClick={() => router.push(`/uploads/${u.id}`)} className="cursor-pointer transition-colors hover:bg-canvas">
                    <Td className="tabular font-medium">
                      <Link href={`/uploads/${u.id}`} onClick={(e) => e.stopPropagation()}>{formatDateTime(u.uploaded_at)}</Link>
                    </Td>
                    <Td className="truncate" title={u.original_filename}>{u.original_filename}</Td>
                    <Td className="truncate text-ink-muted">{u.uploaded_by}</Td>
                    <Td align="right">{formatCount(u.row_count)}</Td>
                    <Td align="right">{u.status === "completed" ? (u.change_count === null ? "First upload" : formatCount(u.change_count)) : "—"}</Td>
                    <Td align="right"><UploadStatusBadge status={u.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="uploads" />
          </div>
        ) : null}
      </Panel>
    </>
  );
}
