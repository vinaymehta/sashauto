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
  const list = useListQuery({}, 100, { key: "part_number", direction: "asc" });
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
          {/* Columns size to their content and Description takes the rest; on smaller screens Description and SASH Part
              show under the Part Number instead (and on phones the vendor). */}
          <Table dense>
            <thead>
              <tr>
                <Th>Part Number</Th>
                <Th className="hidden md:table-cell">SASH Part</Th>
                <Th className="hidden w-full lg:table-cell">Description</Th>
                <Th className="hidden sm:table-cell">Vendor</Th>
                <Th align="right">Available Parts</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-neutral-50/60 [&>td]:h-14 [&>td]:py-2">
                  <Td>
                    <span className="block font-medium">{item.part_number}</span>
                    <span className="block max-w-[12rem] truncate text-xs text-ink-muted sm:hidden">{item.vendor_name}</span>
                    {item.sash_part && <span className="block text-xs text-ink-muted md:hidden">SASH {item.sash_part}</span>}
                    {item.description && <span className="block max-w-[14rem] truncate text-xs text-ink-muted lg:hidden" title={item.description}>{item.description}</span>}
                  </Td>
                  <Td className="hidden md:table-cell">{item.sash_part ?? dash}</Td>
                  <Td className="hidden max-w-0 truncate text-ink-muted lg:table-cell" title={item.description ?? undefined}>{item.description ?? dash}</Td>
                  <Td className="hidden max-w-xs truncate sm:table-cell" title={item.vendor_name}>{item.vendor_name}</Td>
                  <Td align="right" className="font-semibold">{formatQty(item.available_qty!)} pcs</Td>
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
