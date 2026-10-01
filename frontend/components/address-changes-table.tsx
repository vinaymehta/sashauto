"use client";

import { useState } from "react";
import type { AddressChange, Paginated } from "@/lib/types";
import { formatCount, formatDate } from "@/lib/format";
import { CheckIcon } from "./icons";
import { useApi, useDebounced } from "./use-api";
import { useListQuery } from "./use-list-query";
import { Alert } from "./ui/feedback";
import { ListToolbar } from "./ui/list-toolbar";
import { SearchInput } from "./ui/search-input";
import { TableSkeleton } from "./ui/skeleton";
import { Pagination, Table, Td, Th } from "./ui/table";

const dash = <span className="text-neutral-300">—</span>;

// Ship To Address changes on current order rows (PO + Part + Type) compared with the previous upload.
export function AddressChangesTable({ uploadId }: { uploadId: number }) {
  const list = useListQuery();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi<Paginated<AddressChange>>(`/api/uploads/${uploadId}/address_changes`, {
    q, page: list.page, per_page: list.perPage,
  });

  return (
    <div>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} address change${data.meta.total === 1 ? "" : "s"}` : ""}>
        <SearchInput label="Search address changes" placeholder="Search PO, part number or address" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load address changes">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={6} columns={6} />
      ) : data && data.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
          <CheckIcon size={32} className="mb-3 text-neutral-300" />
          <p className="text-sm font-semibold text-neutral-900">{q ? "No address changes match" : "No address changes"}</p>
          {!q && <p className="mt-1 max-w-xs text-xs text-neutral-400">Every order row present in both uploads has the same Ship To Address.</p>}
        </div>
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table dense>
            <thead>
              <tr>
                <Th>PO Number</Th>
                <Th>Part Number</Th>
                <Th>Type</Th>
                <Th>Ship Date</Th>
                <Th>Old Address</Th>
                <Th>New Address</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-canvas">
                  <Td className="font-medium">{c.po_number}</Td>
                  <Td>{c.part_number}</Td>
                  <Td>{c.order_type}</Td>
                  <Td className="tabular">{formatDate(c.ship_date)}</Td>
                  <Td className="max-w-80 truncate text-ink-muted line-through decoration-neutral-300" title={c.old_address ?? undefined}>{c.old_address ?? dash}</Td>
                  <Td className="max-w-80 truncate font-medium" title={c.new_address ?? undefined}>{c.new_address ?? dash}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="address changes" />
        </div>
      ) : null}
    </div>
  );
}
