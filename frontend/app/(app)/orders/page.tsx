"use client";

import Link from "next/link";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type { Dashboard, OrderRow, OrdersPage, UploadChoice, UploadDetail } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { AlertIcon, ArrowUpDownIcon, ChevronRightSmallIcon, MapPinIcon, TableIcon } from "@/components/icons";
import { AddressChangesTable } from "@/components/address-changes-table";
import { ChangesTable } from "@/components/changes-table";
import { MoqAlertsTable } from "@/components/moq-alerts-table";
import { cell, OrderDetailPanel } from "@/components/orders/history-row";
import { CreateOrderPanel, UploadOrdersPanel } from "@/components/orders/create-order-panel";
import { OrderActions, UploadPicker } from "@/components/orders/orders-menu";
import { RelatedLink } from "@/components/orders/related-popover";
import { EmailStatus } from "@/components/upload-result";
import { VersionKpis } from "@/components/upload-summary";
import { useSession } from "@/components/session";
import { AGE_FILTER, AgeLegend, ageRowProps, todayParam } from "@/components/age";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { FilterChips, FilterMenu, type FilterGroup } from "@/components/ui/filter-menu";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";

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

// Typed display for the columns the app models itself; every other Excel column shows its imported value.
// PO / Part links list the related rows of the shown upload (`uploadId`; undefined = current order data).
const typedColumns = (uploadId?: number): Record<string, Omit<Column, "key" | "label">> => ({
  type: { render: (r) => <span className="inline-flex items-center gap-1.5">{r.order_type}{r.manual && <Badge>Manual</Badge>}</span> },
  due_date: { render: (r) => date(r.due_date) },
  ship_date: { render: (r) => formatDate(r.ship_date) },
  unit: { render: (r) => <span className="block max-w-64 truncate" title={r.unit ?? undefined}>{text(r.unit)}</span> },
  po_number: { render: (r) => <RelatedLink kind="po" value={r.po_number} uploadId={uploadId} /> },
  part_number: { render: (r) => <RelatedLink kind="part" value={r.part_number} uploadId={uploadId} /> },
  qty: { align: "right", render: (r) => qty(r.qty) },
  previous_qty: { align: "right", render: (r) => qty(r.previous_qty) },
  last_asn_qty: { align: "right", render: (r) => qty(r.last_asn_qty) },
  last_receipt_qty: { align: "right", render: (r) => qty(r.last_receipt_qty) },
});

// All Excel columns of the upload, in file order (same as the history table).
function buildColumns(columns: { key: string; label: string }[], rows: OrderRow[], uploadId?: number): Column[] {
  const TYPED = typedColumns(uploadId);
  return columns.map(({ key, label }) => {
    const typed = TYPED[key];
    if (typed) return { key, label, ...typed };
    const numeric = rows.some((r) => typeof r.source_data?.[label] === "number");
    return {
      key, label, align: numeric ? "right" : "left",
      render: (r) => <span className="block max-w-72 truncate" title={String(r.source_data?.[label] ?? "")}>{cell(r.source_data?.[label])}</span>,
    };
  });
}

// Imported and manual orders have separate ids.
const rowKey = (row: OrderRow) => `${row.manual ? "m" : "r"}${row.id}`;

// One table row. Memoized: the page re-renders when the dashboard, upload list or tabs load or change, and
// re-rendering every cell of 50 rows × all Excel columns each time blocked the browser for over a second.
const OrderTr = memo(function OrderTr({ row, columns, open, today, onSelect }: {
  row: OrderRow; columns: Column[]; open: boolean; today: Date; onSelect: (row: OrderRow) => void;
}) {
  const tint = ageRowProps(row.ship_date, today);
  return (
    <tr className={`cursor-pointer ${tint.className} ${open ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`} title={tint.title}
        onClick={() => onSelect(row)} aria-haspopup="dialog" aria-expanded={open}>
      <Td className="w-10 pr-0! text-ink-muted">
        <ChevronRightSmallIcon size={14} className={open ? "text-accent" : ""} />
      </Td>
      {columns.map((c) => (
        <Td key={c.key} align={c.align === "right" ? "right" : "left"}>{c.render(row)}</Td>
      ))}
    </tr>
  );
});

export default function OrdersPage() {
  const list = useListQuery({}, 50, { key: "ship_date", direction: "asc" });
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const admin = useSession().user?.role === "admin";

  // Which upload's order data is shown: null = the current data (latest upload + manual orders).
  const [uploadId, setUploadId] = useState<number | null>(null);
  const uploads = useApi<{ data: UploadChoice[] }>("/api/uploads/history");

  const { data, error, loading, reload } = useApi<OrdersPage>("/api/orders", {
    search: term, ...list.filters, today: todayParam(), sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
    upload_id: uploadId ?? undefined,
  });

  // Keep the last known option lists so the panel does not empty while a filtered page loads.
  const [facets, setFacets] = useState<OrdersPage["facets"]>(null);
  if (data?.facets && data.facets !== facets) setFacets(data.facets);
  const filters: FilterGroup[] = [
    { key: "type", label: "Type", options: [{ value: "Order", label: "Order" }, { value: "Firm", label: "Firm" }, { value: "Forecast", label: "Forecast" }] },
    { key: "ship_to", label: "Ship To Location", options: (facets?.ship_to_locations ?? []).map((v) => ({ value: v, label: v })) },
    { key: "ship_date", label: "Ship date", type: "date-range", options: [] },
    { key: "commodity_type", label: "Commodity Type", options: (facets?.commodity_types ?? []).map((v) => ({ value: v, label: v })) },
    AGE_FILTER,
  ];
  const filtered = term !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };

  // Keep the last known column list so the header does not vanish while a page loads.
  const [sourceColumns, setSourceColumns] = useState<NonNullable<OrdersPage["columns"]>>([]);
  if (data?.columns && data.columns !== sourceColumns) setSourceColumns(data.columns);
  const rows = data?.data;
  const COLUMNS = useMemo(() => buildColumns(sourceColumns, rows ?? [], uploadId ?? undefined), [sourceColumns, rows, uploadId]);

  const source = data?.source;
  // Row whose order details are open in the side panel; manual order being edited.
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [today] = useState(() => new Date());
  const selectedKey = selected ? rowKey(selected) : null;

  // Detection results of the shown upload (formerly Upload / Detection), as tabs next to the order rows.
  // For the current data they include the detections of manual orders created/edited since the latest upload.
  const dashboard = useApi<Dashboard>("/api/dashboard");
  const latest = dashboard.data?.latest_upload;
  const current = uploadId === null || uploadId === latest?.id;
  const previous = useApi<{ data: UploadDetail }>(current ? null : `/api/uploads/${uploadId}`);
  const shown = current ? latest : previous.data?.data;
  const manual = current ? dashboard.data?.manual_detections : undefined;
  const isFirst = shown?.previous_version === null;
  const quantityChanges = (shown?.stats.increase_count ?? 0) + (shown?.stats.decrease_count ?? 0) + (manual?.quantity_changes ?? 0);
  const addressChanges = (shown?.stats.address_change_count ?? 0) + (manual?.address_changes ?? 0);
  const moqAlerts = (shown?.stats.moq_alert_count ?? 0) + (manual?.moq_alerts ?? 0);
  const tabs = [
    { key: "orders" as const, label: "Orders", icon: <TableIcon size={14} />, count: data?.meta.total ?? null },
    ...(!shown || (isFirst && quantityChanges + addressChanges === 0) ? [] : [
      { key: "changes" as const, label: "Quantity changes", icon: <ArrowUpDownIcon size={14} />, count: quantityChanges },
      { key: "addresses" as const, label: "Address changes", icon: <MapPinIcon size={14} />, count: addressChanges },
    ]),
    ...(!shown || (isFirst && moqAlerts === 0) ? [] : [
      { key: "moq" as const, label: "MOQ alerts", icon: <AlertIcon size={14} />, count: moqAlerts },
    ]),
  ];
  type TabKey = (typeof tabs)[number]["key"];
  const [tab, setTab] = useState<TabKey>("orders");
  // Fall back to the order rows when the chosen tab no longer exists (e.g. a new first upload).
  const activeTab: TabKey = tabs.some((t) => t.key === tab) ? tab : "orders";

  const [panel, setPanel] = useState<"upload" | "create" | null>(null);
  const reloadDashboard = dashboard.reload;
  const reloadUploads = uploads.reload;
  const onFinished = useCallback((upload: UploadDetail) => {
    if (upload.status === "completed") {
      setUploadId(null);
      reload();
      reloadDashboard();
      reloadUploads();
      setPanel(null);
    }
  }, [reload, reloadDashboard, reloadUploads]);
  const onManualSaved = () => { reload(); reloadDashboard(); };

  function chooseUpload(id: number | null) {
    setUploadId(id);
    setSelected(null);
    list.resetPage();
  }

  return (
    <>
      <PageHeader
        title="Orders"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <UploadPicker uploads={uploads.data?.data ?? []} latestId={latest?.id} selectedId={uploadId} onSelect={chooseUpload} />
            <OrderActions downloadId={source?.upload_id} onUpload={() => setPanel("upload")} onCreate={admin ? () => setPanel("create") : undefined} />
          </div>
        }
      />

      {panel === "upload" && <UploadOrdersPanel onClose={() => setPanel(null)} onUploaded={onFinished} />}
      {(panel === "create" || editing) && (
        <CreateOrderPanel key={editing ? `edit-${editing.id}` : "create"} order={editing ?? undefined}
                          onClose={() => { setPanel(null); setEditing(null); }} onSaved={onManualSaved}
                          shipToLocations={facets?.ship_to_locations} commodityTypes={facets?.commodity_types} />
      )}

      {current && dashboard.data && dashboard.data.open_product_conflicts > 0 && (
        <div className="mb-5">
          <Alert tone="warning">
            {dashboard.data.open_product_conflicts} Commodity Type conflict{dashboard.data.open_product_conflicts === 1 ? " needs" : "s need"} review.{" "}
            <Link href="/products?conflicts=open" className="font-medium underline">Review products</Link>
          </Alert>
        </div>
      )}
      {shown && <div className="mb-6"><VersionKpis upload={shown} /></div>}

      <div className="flex items-center overflow-x-auto border-b border-line">
        <Tabs active={activeTab} onChange={setTab} tabs={tabs} />
        {shown && !(isFirst && shown.emails.length === 0) && (
          <div className="ml-auto pb-1.5 pl-4"><EmailStatus uploadId={shown.id} emails={shown.emails} onChanged={current ? reloadDashboard : previous.reload} /></div>
        )}
      </div>
      {/* Keyed so a tab fades in when opened; the order rows do not depend on the upload summary, so the
          table is not rebuilt when the dashboard data arrives. */}
      <section key={activeTab === "orders" ? "orders" : `${activeTab}-${shown?.id}`} className="animate-fade-in overflow-hidden rounded-lg border border-line border-t-0 bg-surface shadow-card">
        {activeTab === "changes" && shown ? (
          <ChangesTable uploadId={shown.id} manual={current}
                        emptyDescription="Every order row present in both the previous and the latest upload has the same quantity." />
        ) : activeTab === "addresses" && shown ? (
          <AddressChangesTable uploadId={shown.id} manual={current} />
        ) : activeTab === "moq" && shown ? (
          <MoqAlertsTable uploadId={shown.id} manual={current} />
        ) : (
        <>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} order row${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search orders" placeholder="Search PO, part, commodity, type, location…" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-80" />
          <FilterMenu groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        <AgeLegend />

        {error ? (
          <div className="p-4"><Alert title="Could not load orders">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={10} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No order rows match" : "No order data yet"}
            description={filtered ? "Try a different search or clear the filters." : "Upload a Supplier Requirements export with Upload file."}
            action={filtered ? <Button size="sm" onClick={clearAll}>Clear search and filters</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            <Table dense>
              <thead>
                <tr>
                  <th aria-label="Details" className="h-10 w-10 border-b border-neutral-200 bg-neutral-50" />
                  {COLUMNS.map((c) => (
                    <SortTh key={c.key} label={c.label} sortKey={c.key} align={c.align ?? "left"}
                            sort={list.sort} direction={list.direction} onSort={list.toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <OrderTr key={rowKey(row)} row={row} columns={COLUMNS} open={selectedKey === rowKey(row)} today={today} onSelect={setSelected} />
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="order rows" />
          </div>
        ) : null}
        </>
        )}
      </section>
      {selected && (
        <OrderDetailPanel key={`${selected.manual ? "m" : "r"}${selected.id}`} row={selected} onClose={() => setSelected(null)}
                          onEdit={() => { setEditing(selected); setSelected(null); }} onDeleted={onManualSaved} />
      )}
    </>
  );
}
