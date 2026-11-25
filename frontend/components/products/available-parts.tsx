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
import { ColumnsMenu } from "../ui/columns-menu";
import { useTableColumns, type ColumnDef } from "../use-table-columns";
import { ExportButton, fetchAllRows } from "../ui/export-button";

// The columns of the Current inventory table (Columns chooses and orders them per user).
const INVENTORY_COLUMNS: ColumnDef[] = [
  { key: "part_number", label: "Part Number" },
  { key: "sash_part", label: "SASH Part" },
  { key: "description", label: "Description" },
  { key: "vendor", label: "Vendor" },
  { key: "available_qty", label: "Current Inventory", align: "right" },
];

const dash = <span className="text-neutral-300">—</span>;

// Products page, "Current inventory" tab: the parts a vendor has available now (its "Current Inventory" quantity, entered
// with the vendor's part), with the vendor and the quantity.
export function AvailablePartsPanel() {
  const columns = useTableColumns("current_inventory", INVENTORY_COLUMNS);
  const list = useListQuery({}, 100, { key: "part_number", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi<Paginated<VendorProduct>>("/api/available_parts", { q, page: list.page, per_page: list.perPage });

  return (
    <Panel flush>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} part${data.meta.total === 1 ? "" : "s"} in current inventory` : ""}>
        <SearchInput label="Search current inventory" placeholder="Search part, SASH part, description or vendor" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
        <ColumnsMenu {...columns.menu} />
        <ExportButton<VendorProduct> filename="current-inventory" columns={columns.shown}
          load={() => fetchAllRows<VendorProduct>("/api/available_parts", { q })}
          value={(i, key) => key === "part_number" ? i.part_number : key === "sash_part" ? i.sash_part : key === "description" ? i.description
            : key === "vendor" ? i.vendor_name : i.available_qty} />
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load the current inventory">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={10} columns={5} />
      ) : data && data.data.length === 0 ? (
        <EmptyState
          title={q ? "No current inventory matches" : "No current inventory yet"}
          description={q ? "Try a different search." : "Enter Current Inventory for a vendor's part on the Vendors page (edit the part)."}
          action={q ? <Button size="sm" onClick={() => setSearch("")}>Clear search</Button> : undefined}
        />
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table dense stickyHeader>
            <thead>
              <tr>
                {columns.shown.map((c) => columns.head(c, <Th key={c.key} align={c.align}>{c.label}</Th>))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-neutral-50/60 [&>td]:h-14 [&>td]:py-2">
                  {columns.shown.map((c) => {
                    switch (c.key) {
                      case "part_number": return <Td key={c.key}><span className="block font-medium">{item.part_number}</span></Td>;
                      case "sash_part": return <Td key={c.key}>{item.sash_part ?? dash}</Td>;
                      case "description": return <Td key={c.key} className="max-w-[24rem] truncate text-ink-muted" title={item.description ?? undefined}>{item.description ?? dash}</Td>;
                      case "vendor": return <Td key={c.key} className="max-w-xs truncate" title={item.vendor_name}>{item.vendor_name}</Td>;
                      default: return <Td key={c.key} align="right" className="font-semibold">{formatQty(item.available_qty!)} pcs</Td>;
                    }
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="current inventory" />
        </div>
      ) : null}
    </Panel>
  );
}
