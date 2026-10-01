"use client";

import { useState } from "react";
import type { MoqAlert, Paginated } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { CheckIcon } from "./icons";
import { useApi, useDebounced } from "./use-api";
import { useListQuery } from "./use-list-query";
import { Alert } from "./ui/feedback";
import { ListToolbar } from "./ui/list-toolbar";
import { SearchInput } from "./ui/search-input";
import { TableSkeleton } from "./ui/skeleton";
import { Pagination, Table, Td, Th } from "./ui/table";

// MOQ alerts of an upload: current rows (PO + Part + Type) whose Qty is below the Part Number's MOQ.
export function MoqAlertsTable({ uploadId }: { uploadId: number }) {
  const list = useListQuery();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi<Paginated<MoqAlert>>(`/api/uploads/${uploadId}/moq_alerts`, {
    q, page: list.page, per_page: list.perPage,
  });

  return (
    <div>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} MOQ alert${data.meta.total === 1 ? "" : "s"}` : ""}>
        <SearchInput label="Search MOQ alerts" placeholder="Search PO or part number" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load MOQ alerts">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={6} columns={6} />
      ) : data && data.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
          <CheckIcon size={32} className="mb-3 text-neutral-300" />
          <p className="text-sm font-semibold text-neutral-900">{q ? "No MOQ alerts match" : "No MOQ alerts"}</p>
          {!q && <p className="mt-1 max-w-xs text-xs text-neutral-400">No order row is below its Part Number&rsquo;s MOQ in this upload.</p>}
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
                <Th align="right">Qty</Th>
                <Th align="right">MOQ</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-canvas">
                  <Td className="font-medium">{c.po_number}</Td>
                  <Td>{c.part_number}</Td>
                  <Td>{c.order_type}</Td>
                  <Td className="tabular">{formatDate(c.ship_date)}</Td>
                  <Td align="right" className="tabular font-semibold text-down">{formatQty(c.qty)}</Td>
                  <Td align="right" className="tabular">{formatQty(c.moq)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="MOQ alerts" />
        </div>
      ) : null}
    </div>
  );
}
