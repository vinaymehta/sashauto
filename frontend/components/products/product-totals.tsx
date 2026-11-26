"use client";

import { Fragment, useMemo, useState } from "react";
import type { PartsSummaryRow } from "@/lib/types";
import { formatCount, formatQty } from "@/lib/format";
import { useApi } from "../use-api";
import { BusinessPicker, useBusiness } from "../business-switch";
import { RelatedLink } from "../orders/related-popover";
import { formatCustomer } from "../vendors/price-format";
import { Alert, EmptyState } from "../ui/feedback";
import { ListToolbar } from "../ui/list-toolbar";
import { Panel } from "../ui/panel";
import { SearchInput } from "../ui/search-input";
import { TableSkeleton } from "../ui/skeleton";
import { Table, Td, Th } from "../ui/table";
import { ColumnsMenu } from "../ui/columns-menu";
import { useTableColumns, type ColumnDef } from "../use-table-columns";
import { ExportButton } from "../ui/export-button";

type SortKey = "part_number" | "ordered" | "delivered" | "in_transit" | "dispatched" | "pending_dtp" | "pending" | "forecast" | "revenue_ordered" | "revenue_delivered";
// The quantity columns, in the order (and colours) of the six figures of a part's Product summary, then Forecast.
// `due`: shown in amber while above 0. "Pending as per …" names the business shown (Deere for both together).
const qtyColumns = (business: string): { key: SortKey; label: string; tone?: string; due?: boolean }[] => [
  { key: "ordered", label: "Total ordered" },
  { key: "delivered", label: "Delivered to Deere", tone: "text-green-700" },
  { key: "in_transit", label: "In transit", tone: "text-violet-700" },
  { key: "dispatched", label: "Dispatched", tone: "text-violet-700" },
  { key: "pending_dtp", label: `Pending as per ${business}`, due: true },
  { key: "pending", label: "Pending to dispatch", due: true },
  { key: "forecast", label: "Forecast", tone: "text-ink-muted" },
];

// All the columns of the table, in the default order (Columns chooses and orders them per user).
const TOTALS_COLUMNS: ColumnDef[] = [
  { key: "part_number", label: "Part Number" },
  { key: "description", label: "Description" },
  { key: "pos_orders", label: "POs · Orders", align: "right" },
  { key: "revenue_ordered", label: "Revenue ordered", align: "right" },
  { key: "revenue_delivered", label: "Revenue delivered", align: "right" },
  ...qtyColumns("DTP").map((c): ColumnDef => ({ key: c.key, label: c.label, align: "right" })),
];

// Products page, "Product summary" tab: every part of the shown order data (the Business menu) with what was ordered,
// delivered to Deere, is in transit, was dispatched from India, is still open at Deere and still to dispatch (as the
// six figures of a part's Product summary), its Forecast and the revenue
// (Deere prices) of what was ordered and delivered; largest revenue first, any column sorts. A part opens its Product
// summary.
export function ProductTotalsPanel() {
  const { data, error, loading } = useApi<{ data: PartsSummaryRow[]; currency: string | null }>("/api/orders/parts_summary");
  const columns = useTableColumns("product_summary", TOTALS_COLUMNS);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "revenue_ordered", desc: true });
  const { view } = useBusiness();
  const COLUMNS = qtyColumns(view === "gmbh" ? "GMBH" : view === "dtp" ? "DTP" : "Deere");
  // Column headings follow the business shown ("Pending as per GMBH", or Deere for both).
  const labelOf = (key: string, label: string) => COLUMNS.find((c) => c.key === key)?.label ?? label;
  const money = (v: string) => (data?.currency ? formatCustomer(v, data.currency, 2) : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = (data?.data ?? []).filter((r) => !term || r.part_number.toLowerCase().includes(term) || (r.description ?? "").toLowerCase().includes(term));
    const value = (r: PartsSummaryRow) => (sort.key === "part_number" ? r.part_number : Number(r[sort.key]));
    return [...list].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const order = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return sort.desc ? -order : order;
    });
  }, [data, search, sort]);
  // Totals of the listed parts.
  const total = (key: keyof PartsSummaryRow) => rows.reduce((sum, r) => sum + Number(r[key]), 0);
  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "part_number" }));
  const head = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <Th align={align}>
      <button type="button" onClick={() => sortBy(key)} className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider ${sort.key === key ? "text-neutral-900" : "text-neutral-600 hover:text-neutral-900"}`}>
        {label}{sort.key === key && <span aria-hidden>{sort.desc ? "↓" : "↑"}</span>}
      </button>
    </Th>
  );

  return (
    <Panel flush>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink">Business</span>
          <BusinessPicker alignLeft />
        </div>
      </div>
      <ListToolbar summary={data ? `${formatCount(rows.length)} part${rows.length === 1 ? "" : "s"} · revenue on ordered ${money(String(total("revenue_ordered")))} · on delivered ${money(String(total("revenue_delivered")))}` : ""}>
        <SearchInput label="Search parts" placeholder="Search part number or description" value={search} onSearch={setSearch} className="w-full sm:w-72" />
        <ColumnsMenu {...columns.menu} />
        <ExportButton<PartsSummaryRow> filename="product-summary" columns={columns.shown} rows={rows}
          value={(r, key) => key === "part_number" ? r.part_number : key === "description" ? r.description
            : key === "pos_orders" ? `${r.pos} POs · ${r.orders} orders${r.open_orders > 0 ? ` (${r.open_orders} open)` : ""}` : (r as unknown as Record<string, string>)[key]} />
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load the product summary">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={10} columns={12} />
      ) : rows.length === 0 ? (
        <EmptyState title={search ? "No parts match" : "No orders yet"} description={search ? "Try a different search." : "Parts show here once the business has order data."} />
      ) : (
        <Table dense stickyHeader>
          <thead>
            <tr>
              {columns.shown.map((c) => c.key === "description" || c.key === "pos_orders"
                ? columns.head(c, <Th key={c.key} align={c.align}>{c.label}</Th>)
                : columns.head(c, <Fragment key={c.key}>{head(c.key as SortKey, labelOf(c.key, c.label), c.align === "left" ? "left" : "right")}</Fragment>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.part_number} className="hover:bg-canvas">
                {columns.shown.map((col) => {
                  switch (col.key) {
                    case "part_number": return <Td key={col.key}><RelatedLink kind="part" value={r.part_number} /></Td>;
                    case "description": return <Td key={col.key}><span className="line-clamp-2 block w-44 whitespace-normal leading-snug text-ink-muted" title={r.description ?? undefined}>{r.description ?? "—"}</span></Td>;
                    // Opens the part's Product summary: its POs and every order line (ordered, dispatched, delivered, pending).
                    case "pos_orders": return (
                      <Td key={col.key} align="right" className="text-ink-muted">
                        <RelatedLink kind="part" value={r.part_number}>
                          {formatCount(r.pos)} · {formatCount(r.orders)}{r.open_orders > 0 ? ` (${formatCount(r.open_orders)} open)` : ""}
                        </RelatedLink>
                      </Td>
                    );
                    case "revenue_ordered": return <Td key={col.key} align="right" className="font-semibold text-ink">{money(r.revenue_ordered)}</Td>;
                    case "revenue_delivered": return <Td key={col.key} align="right" className="font-semibold text-green-700">{Number(r.revenue_delivered) === 0 ? <span className="font-normal text-neutral-300">—</span> : money(r.revenue_delivered)}</Td>;
                    default: {
                      const c = COLUMNS.find((x) => x.key === col.key)!;
                      return (
                        <Td key={c.key} align="right" className={`${c.due && Number(r[c.key]) > 0 ? "font-semibold text-amber-700" : c.tone ?? "text-ink"}`}>
                          {Number(r[c.key]) === 0 ? <span className="text-neutral-300">—</span> : formatQty(r[c.key] as string)}
                        </Td>
                      );
                    }
                  }
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
