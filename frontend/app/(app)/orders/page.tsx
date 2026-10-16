"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, memo, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Dashboard, OrderRow, OrdersPage, Role, UploadChoice, UploadDetail } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { AlertIcon, ArrowUpDownIcon, MapPinIcon, TableIcon } from "@/components/icons";
import { AddressChangesTable } from "@/components/address-changes-table";
import { ChangesTable } from "@/components/changes-table";
import { MoqAlertsTable } from "@/components/moq-alerts-table";
import { cell, OrderDetailPanel, PlaceOrderPanel } from "@/components/orders/history-row";
import { CreateOrderPanel, UploadOrdersPanel } from "@/components/orders/create-order-panel";
import { OrderActions, UploadPicker } from "@/components/orders/orders-menu";
import { DeliveryCell } from "@/components/orders/delivery-cell";
import { OpenOrderContext, OrderDetailsLink } from "@/components/orders/order-details-modal";
import { RelatedLink } from "@/components/orders/related-popover";
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
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";

type Align = "left" | "right";
interface Column {
  key: string; // sort key accepted by GET /api/orders
  label: string;
  align?: Align;
  sortable?: boolean; // false for columns the app computes (not in the file)
  render: (row: OrderRow) => ReactNode;
}

// The file's Unit Price is per 100 pcs; the price of one piece is shown next to it.
const pricePerPiece = (r: OrderRow) => {
  const raw = r.source_data?.["Unit Price"];
  const n = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isNaN(n) ? dash : (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

const dash = <span className="text-neutral-300">—</span>;
const text = (value: string | null) => value ?? dash;
const date = (value: string | null) => (value ? formatDate(value) : dash);
const qty = (value: string | null) => (value === null ? dash : formatQty(value));

// Qty of an order. A combined order (below-MOQ orders of the same PO + Part + Type combined until the MOQ) shows
// its total in bold; its orders, and whether it is below the MOQ, are shown in Order details.
function QtyCell({ row }: { row: OrderRow }) {
  const c = row.combined;
  return (
    <span className="inline-flex items-center justify-end">
      <span className={c ? "font-semibold" : ""} title={c ? `Combined from ${c.members.length} orders — see Order details` : undefined}>
        {qty(c ? c.total : row.qty)}
      </span>
    </span>
  );
}

// "PO generated" when its POs order the whole Qty, else how much is ordered (the rest is still open).
function OrderedBadge({ row }: { row: OrderRow }) {
  const total = Number(row.combined ? row.combined.total : row.qty ?? 0);
  const ordered = Number(row.ordered_qty ?? 0);
  if (ordered >= total) return <Badge tone="up">PO generated</Badge>;
  return <span title={`${formatQty(String(total - ordered))} still to order`}><Badge tone="warn">PO {formatQty(String(ordered))} of {formatQty(String(total))}</Badge></span>;
}

// Opens the Place order panel for a row (provided by the Orders page; null for the Warehouse Manager).
const PlaceOrderContext = createContext<((row: OrderRow) => void) | null>(null);

// Unit, clickable like the PO and Part Numbers: opens Place order. Plain text when placing is not available.
function UnitLink({ row }: { row: OrderRow }) {
  const place = useContext(PlaceOrderContext);
  const label = <span className="block max-w-64 truncate" title={row.unit ?? undefined}>{text(row.unit)}</span>;
  if (!place || !row.unit?.trim()) return label;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); place(row); }}
            className="max-w-full text-left font-medium text-ink underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
      {label}
    </button>
  );
}

// Typed display for the columns the app models itself; every other Excel column shows its imported value.
// PO Number opens the ORDER DETAILS window; Part links list the related POs of the shown upload (`uploadId`;
// undefined = current order data).
const typedColumns = (uploadId?: number): Record<string, Omit<Column, "key" | "label">> => ({
  type: { render: (r) => <span className="inline-flex items-center gap-1.5">{r.order_type}{r.manual && <Badge>Manual</Badge>}{r.placed && <OrderedBadge row={r} />}</span> },
  due_date: { render: (r) => date(r.due_date) },
  ship_date: { render: (r) => formatDate(r.ship_date) },
  unit: { render: (r) => <UnitLink row={r} /> },
  // PO Number (opens Order details), with tags for a combined order and an order still below the MOQ.
  po_number: {
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <OrderDetailsLink row={r} />
        {r.combined && (
          <span title={`Combined from ${r.combined.members.length} orders — see Order details`}
                className="inline-flex items-center whitespace-nowrap rounded border border-tint-violet-ink/25 bg-tint-violet px-2 py-0.5 text-xs font-medium text-tint-violet-ink">
            Combined · {r.combined.members.length}
          </span>
        )}
        {r.below_moq && (
          <span title={r.moq ? `Below the MOQ of ${r.moq}` : "Below the part's MOQ"}><Badge tone="warn">Low MOQ</Badge></span>
        )}
      </span>
    ),
  },
  // Shipped somewhere other than the default Ship To (also emailed after each upload).
  ship_to_address: {
    render: (r) => (
      <span className="inline-flex max-w-80 items-center gap-1.5">
        <span className="truncate" title={String(r.source_data?.["Ship To Address"] ?? "")}>{cell(r.source_data?.["Ship To Address"])}</span>
        {r.other_ship_to && <span title="Not the default Ship To address"><Badge tone="warn">Other Ship To</Badge></span>}
      </span>
    ),
  },
  part_number: { render: (r) => <RelatedLink kind="part" value={r.part_number} uploadId={uploadId} /> },
  qty: { align: "right", render: (r) => <QtyCell row={r} /> },
  previous_qty: { align: "right", render: (r) => qty(r.previous_qty) },
  last_asn_qty: { align: "right", render: (r) => qty(r.last_asn_qty) },
  last_receipt_qty: { align: "right", render: (r) => qty(r.last_receipt_qty) },
});

// All Excel columns of the upload, in file order (same as the history table).
function buildColumns(columns: { key: string; label: string }[], uploadId?: number, numericKeys?: Set<string>): Column[] {
  const TYPED = typedColumns(uploadId);
  return columns.flatMap(({ key, label }): Column[] => {
    const typed = TYPED[key];
    const numeric = numericKeys?.has(key) ?? false;
    const column: Column = typed ? { key, label, ...typed } : {
      key, label, align: numeric ? "right" : "left",
      render: (r) => <span className="block max-w-72 truncate" title={String(r.source_data?.[label] ?? "")}>{cell(r.source_data?.[label])}</span>,
    };
    // "Price per piece" (Unit Price ÷ 100) just before the file's Unit Price.
    if (label === "Unit Price") {
      return [{ key: "price_per_piece", label: "Price per piece", align: "right", sortable: false, render: pricePerPiece }, column];
    }
    // "Firm Date" (the day the order, or its combined order, first reached the MOQ) just after Due Date.
    if (key === "due_date") {
      return [column, { key: "firm_date", label: "Firm Date", sortable: false, render: (r) => date(r.qty === null ? null : r.firm_date ?? null) }];
    }
    return [column];
  });
}

// Imported and manual orders have separate ids.
const rowKey = (row: OrderRow) => `${row.manual ? "m" : "r"}${row.id}`;

// One table row. Memoized: the page re-renders when the dashboard, upload list or tabs load or change, and
// re-rendering every cell of 50 rows × all Excel columns each time blocked the browser for over a second.
// One order row (not clickable itself): the PO Number opens its details and the Unit opens Place order. The first
// column is the order Status: admin sets received / dispatched, the Warehouse Manager inbound / outbound.
const OrderTr = memo(function OrderTr({ row, columns, open, today, role, onChanged }: {
  row: OrderRow; columns: Column[]; open: boolean; today: Date; role: Role | undefined; onChanged: () => void;
}) {
  const tint = ageRowProps(row.ship_date, today);
  return (
    <tr className={`${tint.className} ${open ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`} title={tint.title}>
      <Td><DeliveryCell row={row} role={role} onChanged={onChanged} /></Td>
      {columns.map((c) => (
        <Td key={c.key} align={c.align === "right" ? "right" : "left"}>{c.render(row)}</Td>
      ))}
    </tr>
  );
});

// ?tab=changes opens the Quantity changes tab (e.g. "View all" on the Dashboard).
export default function OrdersPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={10} columns={8} />}>
      <OrdersView />
    </Suspense>
  );
}

function OrdersView() {
  const params = useSearchParams();
  const list = useListQuery({}, 25, { key: "ship_date", direction: "asc" });
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const role = useSession().user?.role;
  const admin = role === "admin";
  // The Warehouse Manager sees only the order rows (no uploads, versions or detections) and marks deliveries.
  const manager = role === "warehouse_manager";

  // Which upload's order data is shown: null = the current data (latest upload + manual orders).
  const [uploadId, setUploadId] = useState<number | null>(null);
  const uploads = useApi<{ data: UploadChoice[] }>(manager ? null : "/api/uploads/history");

  const { data, error, loading, reload } = useApi<OrdersPage>("/api/orders", {
    search: term, ...list.filters, today: todayParam(), sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
    upload_id: uploadId ?? undefined,
  });

  // useApi keeps the previous response while a new page loads, so the option lists and columns never empty.
  const facets = data?.facets ?? null;

  const filters: FilterGroup[] = [
    { key: "type", label: "Type", options: [{ value: "Order", label: "Order" }, { value: "Firm", label: "Firm" }, { value: "Forecast", label: "Forecast" }] },
    { key: "ship_to", label: "Ship To Location", options: (facets?.ship_to_locations ?? []).map((v) => ({ value: v, label: v })) },
    { key: "ship_date", label: "Ship date", type: "date-range", options: [] },
    { key: "commodity_type", label: "Commodity Type", options: (facets?.commodity_types ?? []).map((v) => ({ value: v, label: v })) },
    AGE_FILTER,
    // Fulfilled orders (delivered to Deere) are hidden unless chosen here.
    { key: "status", label: "Status", options: [
      { value: "none", label: "No status" }, { value: "received", label: "Received" }, { value: "dispatched", label: "Dispatched" },
      { value: "inbound", label: "Inbound" }, { value: "outbound", label: "Outbound (fulfilled)" },
    ] },
  ];
  const filtered = term !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };

  // Keyed by the header names: every response is a new array, but the columns rarely change.
  const columnsKey = (data?.columns ?? []).map((c) => `${c.key}\u0000${c.label}`).join("\u0001");
  const sourceColumns = useMemo(
    () => (columnsKey ? columnsKey.split("\u0001").map((c) => { const [key, label] = c.split("\u0000"); return { key: key!, label: label! }; }) : []),
    [columnsKey],
  );
  const rows = data?.data;
  // Excel columns holding numbers (right-aligned), as a string so the column definitions — and with them the
  // memoized rows — are rebuilt only when this set changes, not on every page of data.
  const numericSignature = useMemo(() => {
    const typed = new Set(Object.keys(typedColumns()));
    return sourceColumns
      .filter(({ key, label }) => !typed.has(key) && (rows ?? []).some((r) => typeof r.source_data?.[label] === "number"))
      .map(({ key }) => key).join(",");
  }, [sourceColumns, rows]);
  const COLUMNS = useMemo(
    () => buildColumns(sourceColumns, uploadId ?? undefined, new Set(numericSignature.split(",").filter(Boolean))),
    [sourceColumns, uploadId, numericSignature],
  );

  const source = data?.source;
  // Row whose order details are open in the side panel; manual order being edited.
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [today] = useState(() => new Date());
  // Row whose Place order panel is open.
  const [placing, setPlacing] = useState<OrderRow | null>(null);
  const selectedKey = placing ? rowKey(placing) : selected ? rowKey(selected) : null;

  // Detection results of the shown upload (formerly Upload / Detection), as tabs next to the order rows.
  // For the current data they include the detections of manual orders created/edited since the latest upload.
  const dashboard = useApi<Dashboard>(manager ? null : "/api/dashboard");
  const latest = dashboard.data?.latest_upload;
  const current = uploadId === null || uploadId === latest?.id;
  const previous = useApi<{ data: UploadDetail }>(current ? null : `/api/uploads/${uploadId}`);
  const shown = current ? latest : previous.data?.data;
  const manual = current ? dashboard.data?.manual_detections : undefined;
  const isFirst = shown?.previous_version === null;
  const quantityChanges = (shown?.stats.increase_count ?? 0) + (shown?.stats.decrease_count ?? 0) + (shown?.stats.new_row_count ?? 0) + (shown?.stats.missing_row_count ?? 0) + (manual?.quantity_changes ?? 0);
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
  const [tab, setTab] = useState<TabKey>(params.get("tab") === "changes" ? "changes" : "orders");
  // Change type the Quantity changes tab starts filtered on (set by clicking a summary card).
  const [changeFilter, setChangeFilter] = useState<string | undefined>(undefined);
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
    setPlacing(null);
    list.resetPage();
  }

  return (
    <>
      <PageHeader
        title="Orders"
        actions={manager ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            <UploadPicker uploads={uploads.data?.data ?? []} latestId={latest?.id} selectedId={uploadId} onSelect={chooseUpload} />
            <OrderActions downloadId={source?.upload_id} onUpload={() => setPanel("upload")} onCreate={admin ? () => setPanel("create") : undefined} />
          </div>
        )}
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
      {shown && (
        <div className="mb-6">
          <VersionKpis upload={shown} onOpen={(target) => { setChangeFilter(target.direction); setTab(target.tab); }} />
        </div>
      )}

      <div className="flex items-center overflow-x-auto border-b border-line">
        <Tabs size="lg" active={activeTab} onChange={(t) => { setChangeFilter(undefined); setTab(t); }} tabs={tabs} />
      </div>
      {/* Keyed so a tab fades in when opened; the order rows do not depend on the upload summary, so the
          table is not rebuilt when the dashboard data arrives. */}
      <section key={activeTab === "orders" ? "orders" : `${activeTab}-${shown?.id}`} className="animate-fade-in overflow-hidden rounded-lg border border-line border-t-0 bg-surface shadow-card">
        {activeTab === "changes" && shown ? (
          <ChangesTable key={changeFilter ?? "all"} uploadId={shown.id} manual={current} direction={changeFilter}
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
            <OpenOrderContext.Provider value={setSelected}>
            <PlaceOrderContext.Provider value={manager ? null : setPlacing}>
            <Table dense>
              <thead>
                <tr>
                  <Th>Status</Th>
                  {COLUMNS.map((c) => (c.sortable === false
                    ? <Th key={c.key} align={c.align ?? "left"}>{c.label}</Th>
                    : <SortTh key={c.key} label={c.label} sortKey={c.key} align={c.align ?? "left"}
                              sort={list.sort} direction={list.direction} onSort={list.toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <OrderTr key={rowKey(row)} row={row} columns={COLUMNS} open={selectedKey === rowKey(row)} today={today}
                           role={role} onChanged={reload} />
                ))}
              </tbody>
            </Table>
            </PlaceOrderContext.Provider>
            </OpenOrderContext.Provider>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="order rows" />
          </div>
        ) : null}
        </>
        )}
      </section>
      {selected && (
        <OrderDetailPanel key={`${selected.manual ? "m" : "r"}${selected.id}`} row={selected} onClose={() => setSelected(null)}
                          onEdit={() => { setEditing(selected); setSelected(null); }} onDeleted={onManualSaved} onPlaced={onManualSaved} />
      )}
      {placing && (
        <PlaceOrderPanel key={`${placing.manual ? "m" : "r"}${placing.id}`} row={placing} onClose={() => setPlacing(null)} onPlaced={onManualSaved} />
      )}
    </>
  );
}
