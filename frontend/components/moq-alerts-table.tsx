"use client";

import { useState } from "react";
import type { MoqAlert, Paginated } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { CheckIcon, DownloadIcon } from "./icons";
import { useApi, useDebounced } from "./use-api";
import { useListQuery } from "./use-list-query";
import { Alert } from "./ui/feedback";
import { ListToolbar } from "./ui/list-toolbar";
import { SearchInput } from "./ui/search-input";
import { TableSkeleton } from "./ui/skeleton";
import { Pagination, Table, Td, Th } from "./ui/table";

// MOQ alerts of an upload, as SASH reports them: per part its Firm Qty, MOQ, Deere's received Qty, the Qty already on
// vendor POs and the Balance to ORDER (Firm less PO issued), which is below the MOQ ("Need MOQ"). A manual order (or
// an upload before the per-part check) is one order: its Qty as Firm and Balance.
// `manual`: also list alerts of manual orders created/edited since this (latest) upload.
export function MoqAlertsTable({ uploadId, manual = false }: { uploadId: number; manual?: boolean }) {
  const list = useListQuery();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi<Paginated<MoqAlert>>(`/api/uploads/${uploadId}/moq_alerts`, {
    q, page: list.page, per_page: list.perPage, manual: manual ? 1 : undefined,
  });

  return (
    <div>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} MOQ alert${data.meta.total === 1 ? "" : "s"}` : ""}>
        <SearchInput label="Search MOQ alerts" placeholder="Search part or PO number" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
        {/* The MOQ alerts as in the MOQ email, as an Excel file. */}
        {data && data.meta.total > 0 && (
          <a href={`/api/uploads/${uploadId}/moq_alerts/export${manual ? "?manual=1" : ""}`} download
             className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-neutral-400 hover:bg-subtle">
            <DownloadIcon size={15} className="text-ink-muted" />
            Export
          </a>
        )}
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load MOQ alerts">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={6} columns={6} />
      ) : data && data.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
          <CheckIcon size={32} className="mb-3 text-neutral-300" />
          <p className="text-sm font-semibold text-neutral-900">{q ? "No MOQ alerts match" : "No MOQ alerts"}</p>
          {!q && <p className="mt-1 max-w-xs text-xs text-neutral-400">No part has a balance to order below its MOQ in this upload.</p>}
        </div>
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table dense>
            <thead>
              <tr>
                <Th align="right">S No.</Th>
                <Th>Part Number</Th>
                <Th>Description</Th>
                <Th>SASH Part</Th>
                <Th align="right">Firm</Th>
                <Th align="right">MOQ</Th>
                <Th align="right">John Deere Received</Th>
                <Th align="right">PO issued</Th>
                <Th align="right" className="bg-tint-amber">Balance to ORDER</Th>
                <Th>Remarks</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c, i) => (
                <tr key={c.id} className="transition-colors hover:bg-canvas">
                  <Td align="right" className="tabular text-ink-muted">{(data.meta.from ?? 1) + i}</Td>
                  <Td className="font-medium">
                    <span title={`PO ${c.po_number}`}>{c.part_number}</span>
                    {!c.per_part && <span className="block text-xs font-normal text-ink-muted">{c.manual ? "Manual order" : "PO"} {c.po_number} · ship {formatDate(c.ship_date)}</span>}
                  </Td>
                  <Td><span className="block max-w-64 truncate" title={c.description ?? ""}>{c.description || "—"}</span></Td>
                  <Td>{c.sash_part || "—"}</Td>
                  <Td align="right" className="tabular">{formatQty(c.firm_qty ?? c.qty)}</Td>
                  <Td align="right" className="tabular">{formatQty(c.moq)}</Td>
                  <Td align="right" className="tabular">{c.received_qty ? formatQty(c.received_qty) : "—"}</Td>
                  <Td align="right" className="tabular">{c.po_issued_qty ? formatQty(c.po_issued_qty) : "—"}</Td>
                  <Td align="right" className="tabular bg-tint-amber/60 font-semibold text-down">{formatQty(c.qty)}</Td>
                  <Td className="whitespace-nowrap">Need MOQ</Td>
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
