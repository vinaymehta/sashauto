"use client";

import { useState, type ReactNode } from "react";
import type { OrderRow, OrdersPage } from "@/lib/types";
import { formatCount, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { DownloadIcon } from "@/components/icons";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader, Panel } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td } from "@/components/ui/table";

type Align = "left" | "right";
interface Column {
  key: string; // sort key accepted by GET /api/orders
  label: string;
  align?: Align;
  render: (row: OrderRow) => ReactNode;
}

const dash = <span className="text-neutral-300">—</span>;
const text = (value: string | null) => value ?? dash;
const date = (value: string | null) => (value ? formatDate(value) : dash);
const qty = (value: string | null) => (value === null ? dash : formatQty(value));

// Same columns and order as the Supplier Requirements export.
const COLUMNS: Column[] = [
  { key: "type", label: "Type", render: (r) => r.order_type },
  { key: "due_date", label: "Due Date", render: (r) => date(r.due_date) },
  { key: "ship_date", label: "Ship Date", render: (r) => formatDate(r.ship_date) },
  { key: "unit", label: "Unit", render: (r) => <span className="block max-w-64 truncate" title={r.unit ?? undefined}>{text(r.unit)}</span> },
  { key: "plant_code", label: "Plant Code", render: (r) => text(r.plant_code) },
  { key: "po_number", label: "PO Number", render: (r) => <span className="font-medium">{r.po_number}</span> },
  { key: "po_line_number", label: "PO Line Number", render: (r) => r.po_line_number },
  { key: "part_number", label: "Part Number", render: (r) => <span className="font-medium">{r.part_number}</span> },
  { key: "commodity_type", label: "Commodity Type", render: (r) => text(r.commodity_type) },
  { key: "qty", label: "Qty", align: "right", render: (r) => qty(r.qty) },
  { key: "previous_qty", label: "Previous Qty", align: "right", render: (r) => qty(r.previous_qty) },
  { key: "last_asn_qty", label: "Last ASN Qty", align: "right", render: (r) => qty(r.last_asn_qty) },
  { key: "last_asn_date", label: "Last ASN Date", render: (r) => date(r.last_asn_date) },
  { key: "last_receipt_qty", label: "Last Receipt Qty", align: "right", render: (r) => qty(r.last_receipt_qty) },
  { key: "last_receipt_date", label: "Last Receipt Date", render: (r) => date(r.last_receipt_date) },
  { key: "last_packing_list_number", label: "Last Packing List Number", render: (r) => text(r.last_packing_list_number) },
  { key: "crossdock_location", label: "Crossdock Location", render: (r) => text(r.crossdock_location) },
  { key: "ship_to_location", label: "Ship to Location", render: (r) => r.ship_to_location },
  { key: "dock_number", label: "Dock Number", render: (r) => text(r.dock_number) },
  { key: "supplier_part_number", label: "Supplier Part Number", render: (r) => text(r.supplier_part_number) },
  { key: "last_released_date", label: "Last Released Date", render: (r) => date(r.last_released_date) },
  { key: "last_updated_date", label: "Last Updated Date", render: (r) => date(r.last_updated_date) },
];

export default function OrdersPage() {
  const list = useListQuery({}, 50, { key: "ship_date", direction: "asc" });
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());

  const { data, error, loading } = useApi<OrdersPage>("/api/orders", {
    search: term, sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });

  const source = data?.source;

  return (
    <>
      <PageHeader
        title="Orders"
        description={source
          ? <>Latest order data, from <span className="font-medium text-ink">{source.original_filename}</span> uploaded {formatDateTime(source.uploaded_at)}.</>
          : "The latest uploaded order data."}
        actions={source && (
          <a href={`/api/uploads/${source.upload_id}/download`} download>
            <Button><DownloadIcon size={15} className="text-ink-muted" />Download .xlsx</Button>
          </a>
        )}
      />

      <Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} order row${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search orders" placeholder="Search PO, part, commodity, type, location…" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-80" />
        </ListToolbar>

        {error ? (
          <div className="p-4"><Alert title="Could not load orders">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={10} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={term ? "No order rows match" : "No order data yet"}
            description={term ? "Try a different search." : "Upload a Supplier Requirements export on Upload / Detection."}
            action={term ? <Button size="sm" onClick={() => { setSearch(""); list.resetPage(); }}>Clear search</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            <Table dense>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <SortTh key={c.key} label={c.label} sortKey={c.key} align={c.align ?? "left"}
                            sort={list.sort} direction={list.direction} onSort={list.toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.id} className="transition-colors duration-150 hover:bg-neutral-50/50">
                    {COLUMNS.map((c) => (
                      <Td key={c.key} align={c.align === "right" ? "right" : "left"}>{c.render(row)}</Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="order rows" />
          </div>
        ) : null}
      </Panel>
    </>
  );
}
