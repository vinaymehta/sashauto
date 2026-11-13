"use client";

import { can } from "@/lib/permissions";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, memo, Suspense, useCallback, useContext, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import type { Dashboard, InvoiceKind, OrderRow, OrdersPage, OrdersSummary, Role, UploadChoice, UploadDetail } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { AlertIcon, ArrowUpDownIcon, CalendarIcon, CheckIcon, FileIcon, HistoryIcon, TableIcon, TruckIcon } from "@/components/icons";
import { AllChangesTable } from "@/components/all-changes-table";
import { MoqAlertsTable } from "@/components/moq-alerts-table";
import { cell, OrderDetailPanel, PlaceOrderPanel } from "@/components/orders/history-row";
import { CreateOrderPanel, UploadOrdersPanel } from "@/components/orders/create-order-panel";
import { InvoiceUploadPanel } from "@/components/orders/invoice-upload-panel";
import { DispatchImportPanel } from "@/components/orders/dispatch-import-panel";
import { OrderActions, UploadPicker } from "@/components/orders/orders-menu";
import { ColumnsMenu } from "@/components/orders/columns-menu";
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

type Align = "left" | "center" | "right";
interface Column {
  key: string; // sort key accepted by GET /api/orders
  label: string;
  align?: Align;
  sortable?: boolean; // false for columns the app computes (not in the file)
  header?: string; // shown in the table header instead of `label` (which also names the file column to read)
  render: (row: OrderRow) => ReactNode;
}
// A column of the table as shown: Status or SASH India Invoice (the app's own, rendered by OrderTr and the header
// themselves) or a column of the file.
type TableColumn = "status" | "sash_india_invoice" | Column;

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
// A text cell shown in full: it wraps onto more lines (up to 18rem wide) instead of ending in "…".
const WRAP = "block min-w-40 max-w-72 whitespace-normal break-words leading-snug";

const PlaceOrderContext = createContext<((row: OrderRow) => void) | null>(null);

// Unit, clickable like the PO and Part Numbers: opens Place order. Plain text when placing is not available. Shown in
// full on one line (a unit is a short place name, e.g. "Parts Distribution Center / PDC - Milan (US)"): the column is
// as wide as it, so rows keep one line.
function UnitLink({ row }: { row: OrderRow }) {
  const place = useContext(PlaceOrderContext);
  const label = <span className="block whitespace-nowrap" title={row.unit ?? undefined}>{text(row.unit)}</span>;
  if (!place || !row.unit?.trim()) return label;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); place(combinedOrder(row)); }}
            className="max-w-full text-center font-medium text-ink underline decoration-neutral-300 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
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
  unit: { align: "center", render: (r) => <UnitLink row={r} /> },
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
        <span className={WRAP} title={String(r.source_data?.["Ship To Address"] ?? "")}>{cell(r.source_data?.["Ship To Address"])}</span>
        {r.other_ship_to && <span title="Not the default Ship To address"><Badge tone="warn">Other Ship To</Badge></span>}
      </span>
    ),
  },
  part_number: {
    render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <RelatedLink kind="part" value={r.part_number} uploadId={uploadId} />
        {r.discontinued && <span title="Discontinued part: no vendor PO can be placed"><Badge tone="dark">Discontinued</Badge></span>}
      </span>
    ),
  },
  qty: { align: "right", render: (r) => <QtyCell row={r} /> },
  previous_qty: { align: "right", render: (r) => qty(r.previous_qty) },
  last_asn_qty: { align: "right", render: (r) => qty(r.last_asn_qty) },
  last_receipt_qty: { align: "right", render: (r) => qty(r.last_receipt_qty) },
});

// The invoices' Qty columns (Columns; not shown until chosen), from the uploaded SASH India / SASH Inc invoices. Order
// Qty is the Qty when dispatched (Deere's later Qty is only what is still open); a row without invoices shows its Qty.
const invoiceTitle = (r: OrderRow, kind: InvoiceKind) => (r.invoice_moves ?? []).filter((m) => m.kind === kind)
  .map((m) => `${m.invoice_number} (${formatDate(m.invoice_date)}): Qty ${formatQty(m.qty)}`).join("\n") || undefined;
const INVOICE_COLUMNS: Column[] = [
  { key: "order_qty", label: "Order Qty", align: "right", sortable: false, render: (r) => qty(r.order_qty ?? r.qty) },
  { key: "shipped_qty", label: "Shipped Qty", align: "right", sortable: false,
    render: (r) => <span title={invoiceTitle(r, "india")}>{qty(r.shipped_qty ?? null)}</span> },
  { key: "balance_qty", label: "Balance Qty", align: "right", sortable: false, render: (r) => qty(r.balance_qty ?? r.qty) },
  { key: "outbound_qty", label: "Outbound Qty", align: "right", sortable: false,
    render: (r) => <span title={invoiceTitle(r, "inc")}>{qty(r.outbound_qty ?? null)}</span> },
  { key: "sash_inc_invoice", label: "SASH Inc Invoice", sortable: false,
    render: (r) => {
      const inc = (r.invoice_moves ?? []).filter((m) => m.kind === "inc");
      return inc.length ? <span className="block max-w-40 truncate whitespace-nowrap tabular" title={invoiceTitle(r, "inc")}>{inc[inc.length - 1]!.invoice_number}</span> : dash;
    } },
];

// All Excel columns of the upload, in file order (same as the history table).
function buildColumns(columns: { key: string; label: string }[], uploadId?: number, numericKeys?: Set<string>): Column[] {
  const TYPED = typedColumns(uploadId);
  // Deere's file can have its own "Description" column: not shown as a second column, it is the Part Description
  // (below); the product's Description (Products) only when the file has none.
  const fileDescription = columns.find((c) => c.label.trim().toLowerCase() === "description")?.label;
  const description = (r: OrderRow) => {
    const fromFile = fileDescription ? r.source_data?.[fileDescription] : null;
    return (typeof fromFile === "string" && fromFile.trim()) || r.part_description || null;
  };
  return columns.flatMap(({ key, label }): Column[] => {
    const typed = TYPED[key];
    const numeric = numericKeys?.has(key) ?? false;
    const column: Column = typed ? { key, label, ...typed } : {
      key, label, align: numeric ? "right" : "left",
      render: (r) => <span className={numeric ? "block max-w-72 truncate" : WRAP} title={String(r.source_data?.[label] ?? "")}>{cell(r.source_data?.[label])}</span>,
    };
    // "Price per piece" (Unit Price ÷ 100) just before the file's Unit Price.
    if (label === "Unit Price") {
      return [{ key: "price_per_piece", label: "Price per piece", header: "Price per piece", align: "right", sortable: false, render: pricePerPiece },
              { ...column, header: "Unit Price (price per 100 pieces)" }];
    }
    // Commodity Type is not shown; Part Description comes right after Part Number.
    if (key === "commodity_type") return [];
    if (label === fileDescription) return [];
    // Part Description: the file's Description, else the product's (Products).
    if (key === "part_number") {
      return [column, { key: "part_description", label: "Part Description", sortable: false,
                        render: (r) => <span className="block w-72 whitespace-normal break-words py-1 leading-snug">{description(r) || "—"}</span> }];
    }
    // The file's own "Firm Date" column is shown as the Firm Date column below (with the date of orders it has none for).
    if (label.trim().toLowerCase() === "firm date") return [];
    // After Due Date: "Firm Date", the day the order first came as Firm / Order (its first upload), and "Effective Firm
    // Date" (from the file, else the day the order, or its combined order, first reached the MOQ; ageing counts from it).
    if (key === "due_date") {
      return [column, { key: "came_firm_date", label: "Firm Date", sortable: false, render: (r) => date(r.came_firm_date ?? null) },
              { key: "firm_date", label: "Effective Firm Date", render: (r) => date(r.qty === null ? null : r.firm_date ?? null) }];
    }
    return [column];
  });
}

// The Orders table columns a user sees until they choose their own (Columns; its Default button goes back to them): ten
// at most, with every clickable column: Status (marks), PO Number (Order details), Part Number (Product summary) and
// Unit (Place order: Generate PO).
const DEFAULT_COLUMNS = ["status", "type", "firm_date", "ship_date", "po_number", "part_number", "part_description", "unit", "qty", "balance_qty"];

// Delivery tabs: the order rows with a fixed Status. Dispatched = part (Dispatch) or all (Dispatched) dispatched from
// SASH Faridabad (SASH India invoices) but not yet at SASH US, Orders fulfilled = delivered to Deere.
const STATUS_TABS: Record<string, string> = { transit: "dispatch,dispatched", fulfilled: "outbound" };

// Imported and manual orders have separate ids.
const rowKey = (row: OrderRow) => `${row.manual ? "m" : "r"}${row.id}`;

// A row of a combined order stands for the combined order (its first row, with the total Qty) when it opens Order
// details or Place order or sets the Status: the PO and Status are recorded there. Other rows as they are.
const combinedOrder = (row: OrderRow): OrderRow => (row.member_of ? { ...row, id: row.member_of.id, qty: row.member_of.total } : row);

// One table row. Memoized: the page re-renders when the dashboard, upload list or tabs load or change, and
// re-rendering every cell of 50 rows × all Excel columns each time blocked the browser for over a second.
// One order row (not clickable itself): the PO Number opens its details and the Unit opens Place order. The columns
// come in the user's order (`columns`, as the header); the Status column: admin sets received / dispatched, the
// Warehouse Manager inbound / outbound.
const OrderTr = memo(function OrderTr({ row, columns, open, today, role, onChanged }: {
  row: OrderRow; columns: TableColumn[]; open: boolean; today: Date; role: Role | undefined; onChanged: () => void;
}) {
  const tint = ageRowProps(row.qty === null ? null : row.firm_date, today); // as the Firm Date column
  return (
    <tr className={`${tint.className} ${open ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`} title={tint.title}>
      {columns.map((c) => (c === "status" ? (
        // A row of a combined order sets the combined order's Status.
        <Td key={c}><DeliveryCell row={combinedOrder(row)} role={role} onChanged={onChanged} /></Td>
      ) : c === "sash_india_invoice" ? (
        // The invoice sent for this row (a combined order's rows each show their own); all of them on hover when it was
        // sent in parts.
        <Td key={c} className="tabular">
          {row.dispatch_invoice
            ? <span className="block max-w-40 truncate whitespace-nowrap" title={(row.dispatch_invoices ?? []).length > 1 ? `Sent in parts:\n${row.dispatch_invoices!.join("\n")}` : row.dispatch_invoice}>{row.dispatch_invoice}</span>
            : <span className="text-neutral-300">—</span>}
        </Td>
      ) : (
        <Td key={c.key} align={c.align ?? "left"}>{c.render(row)}</Td>
      )))}
    </tr>
  );
});

// ?tab=changes opens the Changes tab (e.g. "View all" on the Dashboard).
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
  // The Warehouse Manager (SASH US), with or without Orders edit: their Actions are Upload invoice only (SASH Inc; no
  // Upload file, Create order or Download .xlsx), and Compare versions is not shown.
  const usManager = role === "warehouse_manager";

  // Which upload's order data is shown: null = the current data (latest upload + manual orders).
  const [uploadId, setUploadId] = useState<number | null>(null);
  const uploads = useApi<{ data: UploadChoice[] }>(manager ? null : "/api/uploads/history");

  type TabKey = "orders" | "transit" | "fulfilled" | "changes" | "moq";
  // Opens on Changes (the first tab), or on All Orders when the link brings filters (e.g. from the Dashboard).
  const [tab, setTab] = useState<TabKey>(() => (
    params.get("tab") === "changes" || Object.keys(linkedFilters).length === 0 ? "changes" : "orders"
  ));
  // On a delivery tab (current data only) the list has that tab's Status instead of the Status filter.
  const statusTab = uploadId === null ? STATUS_TABS[tab] : undefined;
  const business = getBusiness();

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
      { value: "none", label: "No status" }, { value: "received", label: "Received" }, { value: "dispatch", label: "Dispatch (part dispatched)" },
      { value: "dispatched", label: "Dispatched" },
      { value: "inbound", label: "Inbound" }, { value: "delivery", label: "Partial outbound (part delivered to Deere)" },
      { value: "outbound", label: "Outbound (fulfilled)" },
    ] },
    { section: "Order", key: "source", label: "Source", options: [{ value: "upload", label: "Uploaded file" }, { value: "manual", label: "Manual orders" }] },
    { section: "Dates", key: "timing", label: "Ship timing", options: [{ value: "overdue", label: "Past ship date" }, { value: "next30", label: "Shipping in next 30 days" }] },
    { section: "Dates", key: "ship_date", label: "Ship date", type: "date-range", options: [] },
    { section: "Dates", key: "firm_date", label: "Effective firm date", type: "date-range", options: [] },
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

  // Columns each user chooses to see, in their order (Columns, saved for the user; DEFAULT_COLUMNS until they choose):
  // Status, SASH India Invoice and the invoices' Qty columns, then the file's. When none of the chosen ones is in this
  // file, the default ones.
  const chooserColumns = useMemo(
    () => [{ key: "status", label: "Status" }, { key: "sash_india_invoice", label: "SASH India Invoice" },
           ...[...INVOICE_COLUMNS, ...COLUMNS].map((c) => ({ key: c.key, label: c.header ?? c.label }))],
    [COLUMNS],
  );
  const chosenKey = (me?.orders_columns ?? DEFAULT_COLUMNS).join("\u0000");
  const savedColumns = useMemo(() => {
    const chosen = [...new Set(chosenKey.split("\u0000"))];
    return chooserColumns.some((c) => chosen.includes(c.key)) ? chosen : DEFAULT_COLUMNS;
  }, [chosenKey, chooserColumns]);
  // The shown columns in the saved order (keys of columns this file does not have are left out): the header and every
  // row render from this one list.
  const shownColumns = useMemo(() => {
    const byKey = new Map([...INVOICE_COLUMNS, ...COLUMNS].map((c) => [c.key, c]));
    return savedColumns.flatMap((key): TableColumn[] => (
      key === "status" || key === "sash_india_invoice" ? [key] : byKey.has(key) ? [byKey.get(key)!] : []
    ));
  }, [COLUMNS, savedColumns]);
  const shownKeys = useMemo(() => shownColumns.map((c) => (typeof c === "string" ? c : c.key)), [shownColumns]);

  // Columns can also be moved by dragging their header in the table (saved for the user like the Columns panel), while
  // Arrange is on: then the headers do not sort, so a drag never sorts by mistake; off, they sort as usual.
  // Column being dragged, and the header it would land beside (`after`: on its right half).
  const { saveOrdersColumns } = useSession();
  const [arranging, setArranging] = useState(false);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<{ key: string; after: boolean } | null>(null);
  const endColumnDrag = () => { setDragColumn(null); setDropColumn(null); };
  const headerDrag = (key: string) => ({
    draggable: true,
    title: "Drag to move this column",
    onDragStart: (e: DragEvent<HTMLTableCellElement>) => { setDragColumn(key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); },
    onDragOver: (e: DragEvent<HTMLTableCellElement>) => {
      if (!dragColumn || dragColumn === key) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      if (dropColumn?.key !== key || dropColumn.after !== after) setDropColumn({ key, after });
    },
    onDrop: (e: DragEvent<HTMLTableCellElement>) => {
      e.preventDefault();
      if (dragColumn && dropColumn) {
        const order = shownKeys.filter((k) => k !== dragColumn);
        order.splice(order.indexOf(dropColumn.key) + (dropColumn.after ? 1 : 0), 0, dragColumn);
        if (order.join("\u0000") !== shownKeys.join("\u0000")) {
          // Only this file's shown columns change place in the saved list (it also keeps other files' columns).
          const shownSet = new Set(shownKeys);
          const rest = [...order];
          saveOrdersColumns(savedColumns.map((k) => (shownSet.has(k) ? rest.shift()! : k))).catch(() => undefined);
        }
      }
      endColumnDrag();
    },
    onDragEnd: endColumnDrag,
    className: `cursor-grab ${dragColumn === key ? "opacity-40" : ""} ${dropColumn?.key === key
      ? `after:absolute after:inset-y-1 after:w-0.5 after:bg-accent ${dropColumn.after ? "after:right-0" : "after:left-0"}` : ""}`,
  });

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
  const dateChanges = shown?.stats.rescheduled_count ?? 0;
  const allChanges = quantityChanges + addressChanges + dateChanges;
  const moqAlerts = (shown?.stats.moq_alert_count ?? 0) + (manual?.moq_alerts ?? 0);
  // The delivery tabs fix the Status, so its filter is not offered there.
  const listFilters = statusTab ? filters.filter((g) => g.key !== "status") : filters;
  const tabs = [
    // Changes first.
    ...(!shown || (isFirst && allChanges === 0) ? [] : [
      { key: "changes" as const, label: "Changes", icon: <ArrowUpDownIcon size={17} />, count: allChanges },
    ]),
    { key: "orders" as const, label: "All Orders", icon: <TableIcon size={17} />, count: statusTab ? null : data?.meta.total ?? null },
    ...(uploadId === null && summary.data ? [
      { key: "transit" as const, label: "Dispatched", icon: <TruckIcon size={17} />, count: summary.data.in_transit },
      { key: "fulfilled" as const, label: "Orders fulfilled", icon: <CheckIcon size={17} />, count: summary.data.fulfilled },
    ] : []),
    ...(!shown || (isFirst && moqAlerts === 0) ? [] : [
      { key: "moq" as const, label: "MOQ alerts", icon: <AlertIcon size={17} />, count: moqAlerts },
    ]),
  ];
  // Change type the Quantity changes tab starts filtered on (set by clicking a summary card).
  const [changeFilter, setChangeFilter] = useState<string | undefined>(undefined);
  // Fall back to the order rows when the chosen tab no longer exists (e.g. a new first upload).
  // While the upload the Changes tab needs is loading, the page waits on Changes (a placeholder) instead of showing the
  // order rows first.
  const changesLoading = tab === "changes" && !manager && can(me, "dashboard")
    && (current ? !dashboard.data && !dashboard.error : !previous.data && !previous.error);
  const activeTab: TabKey = tabs.some((t) => t.key === tab) || changesLoading ? tab : "orders";

  // ?upload=1 (the dashboard's "Upload new file") opens the upload panel.
  // "india" / "inc": the invoice upload of that kind.
  const [panel, setPanel] = useState<"upload" | "create" | "invoice" | "dispatched" | null>(() => (params.get("upload") === "1" && !manager ? "upload" : null));
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
            <OrderActions downloadId={usManager ? undefined : source?.upload_id} onUpload={usManager ? undefined : () => setPanel("upload")}
                          onCreate={admin && !usManager ? () => setPanel("create") : undefined}
                          onUploadInvoice={role === "admin" || role === "warehouse_manager" ? () => setPanel("invoice") : undefined}
                          onImportDispatched={role === "admin" ? () => setPanel("dispatched") : undefined} />
            </>}
            {/* One Actions menu: a Warehouse Manager without Orders edit gets one with only Upload invoice (SASH Inc, the
                US invoices: delivered to Deere). */}
            {manager && role === "warehouse_manager" && <OrderActions onUploadInvoice={() => setPanel("invoice")} />}
          </div>
        )}
      />

      {panel === "upload" && <UploadOrdersPanel onClose={() => setPanel(null)} onUploaded={onFinished} />}
      {panel === "invoice" && <InvoiceUploadPanel onClose={() => setPanel(null)} onSaved={onManualSaved} />}
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
          <Kpi label="90+ days since Effective Firm Date" value={formatCount(summary.data.aged)} hint="Open orders in the red age group" icon={<HistoryIcon size={16} />}
               tint="dec" onClick={() => { setTab("orders"); list.clearFilters(); list.setFilter("age", "red"); }} />
        </dl>
      )}

      {/* On a phone the Order summary and Compare buttons sit above the tabs, so the tabs keep the full width. */}
      <div className="flex flex-col-reverse border-b border-line sm:flex-row sm:items-center">
        <div className="min-w-0 overflow-x-auto">
          <Tabs size="lg" active={activeTab} onChange={(t) => { setChangeFilter(undefined); setTab(t); }} tabs={tabs} />
        </div>
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 self-end sm:mb-1.5 sm:ml-auto sm:self-auto">
        {/* The Order summary (as on Products), on its own page, for those who can see the Products. */}
        {can(me, "products") && (
          <Link href="/orders/summary"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-neutral-400 hover:bg-subtle">
            <CalendarIcon size={15} className="text-ink-muted" />
            Order summary
          </Link>
        )}
        {/* Two versions of one business compared, on their own page (not in "All"). */}
        {!manager && !usManager && business !== "all" && (
          <Link href="/orders/compare"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-neutral-400 hover:bg-subtle">
            <HistoryIcon size={15} className="text-ink-muted" />
            Compare versions
          </Link>
        )}
        </div>
      </div>
      {/* Keyed so a tab fades in when opened; the order rows do not depend on the upload summary, so the
          table is not rebuilt when the dashboard data arrives. */}
      <section key={activeTab === "orders" ? "orders" : `${activeTab}-${shown?.id}`} className="animate-fade-in overflow-hidden rounded-lg border border-line border-t-0 bg-surface shadow-card">
        {changesLoading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : activeTab === "changes" && shown ? (
          <AllChangesTable key={changeFilter ?? "all"} uploadId={shown.id} manual={current} direction={changeFilter} />
        ) : activeTab === "moq" && shown ? (
          <MoqAlertsTable uploadId={shown.id} manual={current} />

        ) : (
        <>
        <ListToolbar wrap summary={data ? `${formatCount(data.meta.total)} order row${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search orders" placeholder="Search PO, part, type, location…" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-80" />
          <FilterMenu groups={listFilters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
          {chooserColumns.length > 2 && (
            <button type="button" onClick={() => { setArranging((on) => !on); endColumnDrag(); }} aria-pressed={arranging}
                    title={arranging ? "Save the column order: headers sort again" : "Drag the column headers to change their order"}
                    className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium transition-colors duration-150 ${
                      arranging ? "bg-accent text-white hover:bg-accent/90" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                    }`}>
              <ArrowUpDownIcon size={15} className={`rotate-90 ${arranging ? "text-white" : "text-ink-muted"}`} />
              {arranging ? "Save" : "Arrange"}
            </button>
          )}
          {chooserColumns.length > 2 && <ColumnsMenu columns={chooserColumns} shown={shownKeys} saved={savedColumns} defaults={DEFAULT_COLUMNS} />}
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
            <Table dense stickyHeader>
              <thead>
                <tr>
                  {shownColumns.map((c) => {
                    const key = typeof c === "string" ? c : c.key;
                    const label = c === "status" ? "Status" : c === "sash_india_invoice" ? "SASH India Invoice" : c.header ?? c.label;
                    const align = typeof c === "string" ? "left" : c.align ?? "left";
                    // Arranging: every header is a drag handle (with a grip), none sorts.
                    if (arranging) {
                      return (
                        <Th key={key} align={align} {...headerDrag(key)}>
                          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="text-neutral-400">⋮⋮</span>{label}</span>
                        </Th>
                      );
                    }
                    return typeof c === "string" || c.sortable === false
                      ? <Th key={key} align={align}>{label}</Th>
                      : <SortTh key={key} label={label} sortKey={key} align={align} sort={list.sort} direction={list.direction} onSort={list.toggleSort} />;
                  })}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <OrderTr key={rowKey(row)} row={row} columns={shownColumns}
                           open={selectedKey === rowKey(combinedOrder(row))} today={today} role={role} onChanged={refresh} />
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
