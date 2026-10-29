"use client";

import { can } from "@/lib/permissions";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, memo, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dashboard, OrderRow, OrdersPage, OrdersSummary, Role, UploadChoice, UploadDetail } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { AlertIcon, ArrowUpDownIcon, CheckIcon, FileIcon, HistoryIcon, MapPinIcon, TableIcon, TruckIcon } from "@/components/icons";
import { AddressChangesTable } from "@/components/address-changes-table";
import { ChangesTable } from "@/components/changes-table";
import { MoqAlertsTable } from "@/components/moq-alerts-table";
import { cell, OrderDetailPanel, PlaceOrderPanel } from "@/components/orders/history-row";
import { CreateOrderPanel, UploadOrdersPanel } from "@/components/orders/create-order-panel";
import { DispatchImportPanel } from "@/components/orders/dispatch-import-panel";
import { OrderActions, UploadPicker } from "@/components/orders/orders-menu";
import { DeliveryCell } from "@/components/orders/delivery-cell";
import { OpenOrderContext, OrderDetailsLink } from "@/components/orders/order-details-modal";
import { RelatedLink } from "@/components/orders/related-popover";
import { Kpi } from "@/components/upload-summary";
import { BUSINESS_LABEL, getBusiness } from "@/lib/business";
import { useSession } from "@/components/session";
import { AGE_FILTER, AgeLegend, ageRowProps, todayParam } from "@/components/age";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/panel";
import { BusinessPicker } from "@/components/business-switch";
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
  header?: string; // shown in the table header instead of `label` (which also names the file column to read)
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

// Qty of the row, as in the file (a row of a combined order too: its total is on the Combined tag and in Order details).
function QtyCell({ row }: { row: OrderRow }) {
  return <span className="inline-flex items-center justify-end">{qty(row.qty)}</span>;
}

// "PO generated" when its POs order the whole Qty, "Order placed" once every PO is also ticked as sent to the vendor,
// else how much is ordered (the rest is still open).
function OrderedBadge({ row }: { row: OrderRow }) {
  const total = Number(row.member_of?.total ?? row.qty ?? 0);
  const ordered = Number(row.ordered_qty ?? 0);
  if (ordered >= total) return row.order_placed ? <Badge tone="dark">Order placed</Badge> : <Badge tone="up">PO generated</Badge>;
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
    <button type="button" onClick={(e) => { e.stopPropagation(); place(combinedOrder(row)); }}
            className="max-w-full text-left font-medium text-ink underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
      {label}
    </button>
  );
}

// Typed display for the columns the app models itself; every other Excel column shows its imported value.
// PO Number opens the ORDER DETAILS window; Part links list the related POs of the shown upload (`uploadId`;
// undefined = current order data).
const typedColumns = (uploadId?: number): Record<string, Omit<Column, "key" | "label">> => ({
  // In "All" each row is tagged with its business (DTP / GMBH).
  type: { render: (r) => <span className="inline-flex items-center gap-1.5">{r.order_type}{getBusiness() === "all" && r.business && <Badge tone="dark">{BUSINESS_LABEL[r.business]}</Badge>}{r.manual && <Badge>Manual</Badge>}{r.placed && <OrderedBadge row={r} />}</span> },
  due_date: { render: (r) => date(r.due_date) },
  ship_date: { render: (r) => formatDate(r.ship_date) },
  unit: { render: (r) => <UnitLink row={r} /> },
  // PO Number (opens Order details), with tags for a combined order and an order still below the MOQ.
  po_number: {
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <OrderDetailsLink row={r} />
        {/* On every row of a combined order. */}
        {r.member_of && (
          <span title={`Combined from ${r.member_of.count} orders (total Qty ${formatQty(r.member_of.total)}) — see Order details`}
                className="inline-flex items-center whitespace-nowrap rounded border border-tint-violet-ink/25 bg-tint-violet px-2 py-0.5 text-xs font-medium text-tint-violet-ink">
            Combined · {r.member_of.count}
          </span>
        )}
        {r.below_moq && (
          <span title={r.moq && r.moq_balance ? `Balance to order ${formatQty(r.moq_balance)} (Firm less PO issued) is below the MOQ of ${formatQty(r.moq)}` : "Below the part's MOQ"}><Badge tone="warn">Low MOQ</Badge></span>
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
  // Deere's file can have its own "Description" column: not shown as a second column, only used in Part Description
  // (below) for parts that are not in Products.
  const fileDescription = columns.find((c) => c.label.trim().toLowerCase() === "description")?.label;
  const description = (r: OrderRow) => {
    const fromFile = fileDescription ? r.source_data?.[fileDescription] : null;
    return r.part_description || (typeof fromFile === "string" && fromFile.trim()) || null;
  };
  return columns.flatMap(({ key, label }): Column[] => {
    const typed = TYPED[key];
    const numeric = numericKeys?.has(key) ?? false;
    const column: Column = typed ? { key, label, ...typed } : {
      key, label, align: numeric ? "right" : "left",
      render: (r) => <span className="block max-w-72 truncate" title={String(r.source_data?.[label] ?? "")}>{cell(r.source_data?.[label])}</span>,
    };
    // "Price per piece" (Unit Price ÷ 100) just before the file's Unit Price.
    if (label === "Unit Price") {
      return [{ key: "price_per_piece", label: "Price per piece", header: "Price per piece", align: "right", sortable: false, render: pricePerPiece },
              { ...column, header: "Unit Price (price per 100 pieces)" }];
    }
    // Commodity Type is not shown; Part Description comes right after Part Number.
    if (key === "commodity_type") return [];
    if (label === fileDescription) return [];
    // Part Description: the product's Description (Products), else the file's for a part not in Products.
    if (key === "part_number") {
      return [column, { key: "part_description", label: "Part Description", sortable: false,
                        render: (r) => <span className="block max-w-72 truncate" title={description(r) ?? ""}>{description(r) || "—"}</span> }];
    }
    // The file's own "Firm Date" column is shown as the Firm Date column below (with the date of orders it has none for).
    if (label.trim().toLowerCase() === "firm date") return [];
    // "Firm Date" (from the file, else the day the order, or its combined order, first reached the MOQ) just after Due Date.
    if (key === "due_date") {
      return [column, { key: "firm_date", label: "Firm Date", render: (r) => date(r.qty === null ? null : r.firm_date ?? null) }];
    }
    return [column];
  });
}

// Delivery tabs: the order rows with a fixed Status. In transit = dispatched from SASH Faridabad (with the SASH India
// Invoice No.) but not yet at SASH US, Orders fulfilled = delivered to Deere.
const STATUS_TABS: Record<string, string> = { transit: "dispatched", fulfilled: "outbound" };

// Imported and manual orders have separate ids.
const rowKey = (row: OrderRow) => `${row.manual ? "m" : "r"}${row.id}`;

// A row of a combined order stands for the combined order (its first row, with the total Qty) when it opens Order
// details or Place order or sets the Status: the PO and Status are recorded there. Other rows as they are.
const combinedOrder = (row: OrderRow): OrderRow => (row.member_of ? { ...row, id: row.member_of.id, qty: row.member_of.total } : row);

// One table row. Memoized: the page re-renders when the dashboard, upload list or tabs load or change, and
// re-rendering every cell of 50 rows × all Excel columns each time blocked the browser for over a second.
// One order row (not clickable itself): the PO Number opens its details and the Unit opens Place order. The first
// column is the order Status: admin sets received / dispatched, the Warehouse Manager inbound / outbound.
const OrderTr = memo(function OrderTr({ row, columns, open, today, role, onChanged }: {
  row: OrderRow; columns: Column[]; open: boolean; today: Date; role: Role | undefined; onChanged: () => void;
}) {
  const tint = ageRowProps(row.qty === null ? null : row.firm_date, today); // as the Firm Date column
  return (
    <tr className={`${tint.className} ${open ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`} title={tint.title}>
      {/* A row of a combined order sets the combined order's Status. */}
      <Td><DeliveryCell row={combinedOrder(row)} role={role} onChanged={onChanged} /></Td>
      {/* The invoice sent for this row (a combined order's rows each show their own); all of them on hover when it was
          sent in parts. */}
      <Td className="tabular">
        {row.dispatch_invoice
          ? <span className="block max-w-40 truncate whitespace-nowrap" title={(row.dispatch_invoices ?? []).length > 1 ? `Sent in parts:\n${row.dispatch_invoices!.join("\n")}` : row.dispatch_invoice}>{row.dispatch_invoice}</span>
          : <span className="text-neutral-300">—</span>}
      </Td>
      {columns.map((c) => (
        <Td key={c.key} align={c.align === "right" ? "right" : "left"}>{c.render(row)}</Td>
      ))}
    </tr>
  );
});

// ?tab=changes opens the Quantity changes tab (e.g. "View all" on the Dashboard).
// Filter keys a link to the Orders page may set.
const LINKABLE_FILTERS = ["type", "status", "source", "timing", "ship_date_from", "ship_date_to", "firm_date_from", "firm_date_to", "age",
  "po", "vendor", "moq", "combined", "ship_to"];

export default function OrdersPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={10} columns={8} />}>
      <OrdersView />
    </Suspense>
  );
}

function OrdersView() {
  const params = useSearchParams();
  // Filters can come in the link (e.g. from the dashboard: /orders?timing=overdue&type=Firm,Order).
  const [linkedFilters] = useState(() => Object.fromEntries(
    LINKABLE_FILTERS.flatMap((key) => (params.get(key) ? [[key, params.get(key)!]] : [])),
  ));
  const list = useListQuery(linkedFilters, 100, { key: "firm_date", direction: "asc" });
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const role = useSession().user?.role;
  const me = useSession().user;
  // Orders edit permission: upload files, add orders, generate POs. Without it the Orders are view-only (delivery
  // marks still follow the role).
  const admin = can(me, "orders", "edit");
  // The Warehouse Manager sees only the order rows (no uploads, versions or detections) and marks deliveries.
  const manager = !admin;

  // Which upload's order data is shown: null = the current data (latest upload + manual orders).
  const [uploadId, setUploadId] = useState<number | null>(null);
  const uploads = useApi<{ data: UploadChoice[] }>(manager ? null : "/api/uploads/history");

  type TabKey = "orders" | "transit" | "fulfilled" | "changes" | "addresses" | "moq";
  const [tab, setTab] = useState<TabKey>(params.get("tab") === "changes" ? "changes" : "orders");
  // On a delivery tab (current data only) the list has that tab's Status instead of the Status filter.
  const statusTab = uploadId === null ? STATUS_TABS[tab] : undefined;

  const { data, error, loading, reload } = useApi<OrdersPage>("/api/orders", {
    search: term, ...list.filters, status: statusTab ?? list.filters.status, today: todayParam(), sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
    upload_id: uploadId ?? undefined,
  });

  // Cards above the table (current order data only).
  const summary = useApi<OrdersSummary>(uploadId === null ? "/api/orders/summary" : null, { today: todayParam() });
  const reloadSummary = summary.reload;
  const refresh = useCallback(() => { reload(); reloadSummary(); }, [reload, reloadSummary]);

  // useApi keeps the previous response while a new page loads, so the option lists and columns never empty.
  const facets = data?.facets ?? null;

  // Grouped in sections, in the order orders are usually narrowed down: what they are, when, purchasing, part and place.
  const filters: FilterGroup[] = [
    { section: "Order", key: "type", label: "Type", options: [{ value: "Order", label: "Order" }, { value: "Firm", label: "Firm" }, { value: "Forecast", label: "Forecast" }] },
    // Fulfilled orders (delivered to Deere) are hidden unless chosen here.
    { section: "Order", key: "status", label: "Status", options: [
      { value: "none", label: "No status" }, { value: "received", label: "Received" }, { value: "dispatched", label: "Dispatched" },
      { value: "inbound", label: "Inbound" }, { value: "outbound", label: "Outbound (fulfilled)" },
    ] },
    { section: "Order", key: "source", label: "Source", options: [{ value: "upload", label: "Uploaded file" }, { value: "manual", label: "Manual orders" }] },
    { section: "Dates", key: "timing", label: "Ship timing", options: [{ value: "overdue", label: "Past ship date" }, { value: "next30", label: "Shipping in next 30 days" }] },
    { section: "Dates", key: "ship_date", label: "Ship date", type: "date-range", options: [] },
    { section: "Dates", key: "firm_date", label: "Firm date", type: "date-range", options: [] },
    { ...AGE_FILTER, section: "Dates" },
    { section: "Purchasing", key: "po", label: "Vendor PO", options: [{ value: "none", label: "No PO yet" }, { value: "generated", label: "PO generated" }, { value: "no_qty", label: "No Qty (nothing to order)" }] },
    { section: "Purchasing", key: "vendor", label: "Vendor", options: (facets?.vendors ?? []).map((v) => ({ value: String(v.id), label: v.name })) },
    { section: "Purchasing", key: "moq", label: "MOQ", options: [{ value: "below", label: "Below MOQ" }, { value: "reached", label: "Reached MOQ" }] },
    { section: "Purchasing", key: "combined", label: "Combined", options: [{ value: "yes", label: "Combined orders" }, { value: "no", label: "Not combined" }] },
    { section: "Part & delivery", key: "ship_to", label: "Ship To Location", options: (facets?.ship_to_locations ?? []).map((v) => ({ value: v, label: v })) },
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
  // A row of a combined order opens the combined order.
  const openOrder = useCallback((r: OrderRow) => setSelected(combinedOrder(r)), []);
  const [today] = useState(() => new Date());
  // Row whose Place order panel is open.
  const [placing, setPlacing] = useState<OrderRow | null>(null);
  const selectedKey = placing ? rowKey(placing) : selected ? rowKey(selected) : null;

  // Detection results of the shown upload (formerly Upload / Detection), as tabs next to the order rows.
  // For the current data they include the detections of manual orders created/edited since the latest upload.
  const dashboard = useApi<Dashboard>(can(me, "dashboard") ? "/api/dashboard" : null);
  const latest = dashboard.data?.latest_upload;
  const current = uploadId === null || uploadId === latest?.id;
  const previous = useApi<{ data: UploadDetail }>(current ? null : `/api/uploads/${uploadId}`);
  const shown = current ? latest : previous.data?.data;
  const manual = current ? dashboard.data?.manual_detections : undefined;
  const isFirst = shown?.previous_version === null;
  const quantityChanges = (shown?.stats.increase_count ?? 0) + (shown?.stats.decrease_count ?? 0) + (shown?.stats.new_row_count ?? 0) + (shown?.stats.missing_row_count ?? 0) + (manual?.quantity_changes ?? 0);
  const addressChanges = (shown?.stats.address_change_count ?? 0) + (manual?.address_changes ?? 0);
  const moqAlerts = (shown?.stats.moq_alert_count ?? 0) + (manual?.moq_alerts ?? 0);
  // The delivery tabs fix the Status, so its filter is not offered there.
  const listFilters = statusTab ? filters.filter((g) => g.key !== "status") : filters;
  const tabs = [
    { key: "orders" as const, label: "Orders", icon: <TableIcon size={17} />, count: statusTab ? null : data?.meta.total ?? null },
    ...(uploadId === null && summary.data ? [
      { key: "transit" as const, label: "In transit", icon: <TruckIcon size={17} />, count: summary.data.in_transit },
      { key: "fulfilled" as const, label: "Orders fulfilled", icon: <CheckIcon size={17} />, count: summary.data.fulfilled },
    ] : []),
    ...(!shown || (isFirst && quantityChanges + addressChanges === 0) ? [] : [
      { key: "changes" as const, label: "Quantity changes", icon: <ArrowUpDownIcon size={17} />, count: quantityChanges },
      { key: "addresses" as const, label: "Address changes", icon: <MapPinIcon size={17} />, count: addressChanges },
    ]),
    ...(!shown || (isFirst && moqAlerts === 0) ? [] : [
      { key: "moq" as const, label: "MOQ alerts", icon: <AlertIcon size={17} />, count: moqAlerts },
    ]),
  ];
  // Change type the Quantity changes tab starts filtered on (set by clicking a summary card).
  const [changeFilter, setChangeFilter] = useState<string | undefined>(undefined);
  // Fall back to the order rows when the chosen tab no longer exists (e.g. a new first upload).
  const activeTab: TabKey = tabs.some((t) => t.key === tab) ? tab : "orders";

  // ?upload=1 (the dashboard's "Upload new file") opens the upload panel.
  const [panel, setPanel] = useState<"upload" | "create" | "dispatched" | null>(() => (params.get("upload") === "1" && !manager ? "upload" : null));
  // …once: ?upload=1 is then dropped from the address, so the panel does not open again when the page is shown anew
  // (switching DTP / GMBH re-mounts it).
  const router = useRouter();
  useEffect(() => {
    if (params.get("upload") !== "1") return;
    const rest = new URLSearchParams(params.toString());
    rest.delete("upload");
    router.replace(rest.size ? `/orders?${rest}` : "/orders", { scroll: false });
  }, [params, router]);
  const reloadDashboard = dashboard.reload;
  const reloadUploads = uploads.reload;
  const onFinished = useCallback((upload: UploadDetail) => {
    if (upload.status === "completed") {
      setUploadId(null);
      refresh();
      reloadDashboard();
      reloadUploads();
      setPanel(null);
    }
  }, [refresh, reloadDashboard, reloadUploads]);
  const onManualSaved = () => { refresh(); reloadDashboard(); };

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
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {/* Which business's orders are shown (DTP, GMBH or both); the same choice as on the Dashboard. */}
            <BusinessPicker />
            {!manager && <>
            <UploadPicker uploads={uploads.data?.data ?? []} latestId={latest?.id} selectedId={uploadId} onSelect={chooseUpload} />
            <OrderActions downloadId={source?.upload_id} onUpload={() => setPanel("upload")} onCreate={admin ? () => setPanel("create") : undefined}
                          onImportDispatched={role === "admin" ? () => setPanel("dispatched") : undefined} />
            </>}
          </div>
        )}
      />

      {panel === "upload" && <UploadOrdersPanel onClose={() => setPanel(null)} onUploaded={onFinished} />}
      {panel === "dispatched" && <DispatchImportPanel onClose={() => setPanel(null)} onImported={refresh} />}
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
      {/* What needs doing on the current orders; clicking a card filters the table or opens its tab. */}
      {summary.data && uploadId === null && (
        <dl className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Open orders" value={formatCount(summary.data.open)} hint="Firm and Order, not yet delivered to Deere" icon={<TableIcon size={16} />}
               tint="violet" onClick={() => { setTab("orders"); list.clearFilters(); list.setFilter("type", "Firm,Order"); }} />
          <Kpi label="PO to generate" value={formatCount(summary.data.po_pending)}
               hint={`Open orders with a Qty and no vendor PO yet · ${formatCount(summary.data.po_generated)} with a PO · ${formatCount(summary.data.no_qty)} without a Qty`}
               icon={<FileIcon size={16} />} tint="amber"
               onClick={() => { setTab("orders"); list.clearFilters(); list.setFilter("type", "Firm,Order"); list.setFilter("po", "none"); }} />
          <Kpi label="Below MOQ" value={formatCount(summary.data.below_moq)} hint="Parts whose balance to order (Firm less PO issued) is below the MOQ" icon={<AlertIcon size={16} />}
               tint="dec" onClick={tabs.some((t) => t.key === "moq") ? () => setTab("moq") : undefined} />
          <Kpi label="90+ days since Firm Date" value={formatCount(summary.data.aged)} hint="Open orders in the red age group" icon={<HistoryIcon size={16} />}
               tint="dec" onClick={() => { setTab("orders"); list.clearFilters(); list.setFilter("age", "red"); }} />
        </dl>
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
          <SearchInput label="Search orders" placeholder="Search PO, part, type, location…" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-80" />
          <FilterMenu groups={listFilters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={listFilters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        <AgeLegend value={list.filters.age} onChange={(v) => list.setFilter("age", v)} />

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
            <OpenOrderContext.Provider value={openOrder}>
            <PlaceOrderContext.Provider value={manager ? null : setPlacing}>
            <Table dense>
              <thead>
                <tr>
                  <Th>Status</Th>
                  <Th>SASH India Invoice</Th>
                  {COLUMNS.map((c) => (c.sortable === false
                    ? <Th key={c.key} align={c.align ?? "left"}>{c.header ?? c.label}</Th>
                    : <SortTh key={c.key} label={c.header ?? c.label} sortKey={c.key} align={c.align ?? "left"}
                              sort={list.sort} direction={list.direction} onSort={list.toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <OrderTr key={rowKey(row)} row={row} columns={COLUMNS} open={selectedKey === rowKey(combinedOrder(row))} today={today}
                           role={role} onChanged={refresh} />
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
