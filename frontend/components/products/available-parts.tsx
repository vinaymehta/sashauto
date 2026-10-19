"use client";

import { useState } from "react";
import type { Paginated, VendorProduct } from "@/lib/types";
import { formatCount, formatQty } from "@/lib/format";
import { useApi, useDebounced } from "../use-api";
import { useListQuery } from "../use-list-query";
import { Button } from "../ui/button";
import { Alert, EmptyState } from "../ui/feedback";
import { ListToolbar } from "../ui/list-toolbar";
import { Panel } from "../ui/panel";
import { SearchInput } from "../ui/search-input";
import { TableSkeleton } from "../ui/skeleton";
import { Pagination, Table, Td, Th } from "../ui/table";

const dash = <span className="text-neutral-300">—</span>;

// Products page, "Available parts" tab: the parts a vendor has available now (its "Available Parts" quantity, entered
// with the vendor's part), with the vendor and the quantity.
export function AvailablePartsPanel() {
  const list = useListQuery({}, 25, { key: "part_number", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi<Paginated<VendorProduct>>("/api/available_parts", { q, page: list.page, per_page: list.perPage });

  return (
    <Panel flush>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} available part${data.meta.total === 1 ? "" : "s"}` : ""}>
        <SearchInput label="Search available parts" placeholder="Search part, SASH part, description or vendor" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load the available parts">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={10} columns={5} />
      ) : data && data.data.length === 0 ? (
        <EmptyState
          title={q ? "No available parts match" : "No available parts yet"}
          description={q ? "Try a different search." : "Enter Available Parts for a vendor's part on the Vendors page (edit the part)."}
          action={q ? <Button size="sm" onClick={() => setSearch("")}>Clear search</Button> : undefined}
        />
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table fixed minWidth="min-w-[900px]">
            <colgroup>
              <col className="w-44" />
              <col className="w-40" />
              <col />
              <col className="w-72" />
              <col className="w-40" />
            </colgroup>
            <thead>
              <tr>
                <Th>Part Number</Th>
                <Th>SASH Part</Th>
                <Th>Description</Th>
                <Th>Vendor</Th>
                <Th align="right">Available Parts</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-neutral-50/60">
                  <Td className="truncate font-medium" title={item.part_number}>{item.part_number}</Td>
                  <Td className="truncate" title={item.sash_part ?? undefined}>{item.sash_part ?? dash}</Td>
                  <Td className="truncate text-ink-muted" title={item.description ?? undefined}>{item.description ?? dash}</Td>
                  <Td className="truncate" title={item.vendor_name}>{item.vendor_name}</Td>
                  <Td align="right" className="tabular font-semibold">{formatQty(item.available_qty!)} pcs</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="available parts" />
        </div>
      ) : null}
    </Panel>
  );
}
