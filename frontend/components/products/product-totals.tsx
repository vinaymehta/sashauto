"use client";

import { Fragment, useMemo, useState } from "react";
import type { PartsSummaryRow } from "@/lib/types";
import { formatCount, formatQty } from "@/lib/format";
import { useApi } from "../use-api";
import { BusinessPicker } from "../business-switch";
import { RelatedLink } from "../orders/related-popover";
import { formatCustomer } from "../vendors/price-format";
import { Alert, EmptyState } from "../ui/feedback";
import { ListToolbar } from "../ui/list-toolbar";
import { Panel } from "../ui/panel";
import { SearchInput } from "../ui/search-input";
import { TableSkeleton } from "../ui/skeleton";
import { Table, Td, Th } from "../ui/table";

type SortKey = "part_number" | "ordered" | "dispatched" | "in_transit" | "delivered" | "pending" | "forecast" | "revenue_ordered" | "revenue_delivered";
const COLUMNS: { key: SortKey; label: string; tone?: string }[] = [
  { key: "ordered", label: "Ordered" }, { key: "dispatched", label: "Dispatched", tone: "text-violet-700" },
  { key: "in_transit", label: "In transit", tone: "text-blue-700" }, { key: "delivered", label: "Delivered", tone: "text-green-700" },
  { key: "pending", label: "Pending" }, { key: "forecast", label: "Forecast", tone: "text-ink-muted" },
];

// Products page, "Product summary" tab: every part of the shown order data (the Business menu) with what was ordered,
// dispatched from India, is in transit, was delivered to Deere and is still to dispatch, its Forecast and the revenue
// (Deere prices) of what was ordered and delivered; largest revenue first, any column sorts. A part opens its Product
// summary.
export function ProductTotalsPanel() {
  const { data, error, loading } = useApi<{ data: PartsSummaryRow[]; currency: string | null }>("/api/orders/parts_summary");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "revenue_ordered", desc: true });
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
          <BusinessPicker />
        </div>
      </div>
      <ListToolbar summary={data ? `${formatCount(rows.length)} part${rows.length === 1 ? "" : "s"} · revenue on ordered ${money(String(total("revenue_ordered")))} · on delivered ${money(String(total("revenue_delivered")))}` : ""}>
        <SearchInput label="Search parts" placeholder="Search part number or description" value={search} onSearch={setSearch} className="w-full sm:w-72" />
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load the product summary">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={10} columns={10} />
      ) : rows.length === 0 ? (
        <EmptyState title={search ? "No parts match" : "No orders yet"} description={search ? "Try a different search." : "Parts show here once the business has order data."} />
      ) : (
        <Table dense stickyHeader>
          <thead>
            <tr>
              {head("part_number", "Part Number", "left")}
              <Th>Description</Th>
              <Th align="right">POs · Orders</Th>
              {head("revenue_ordered", "Revenue ordered")}
              {head("revenue_delivered", "Revenue delivered")}
              {COLUMNS.map((c) => <Fragment key={c.key}>{head(c.key, c.label)}</Fragment>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.part_number} className="hover:bg-canvas">
                <Td><RelatedLink kind="part" value={r.part_number} /></Td>
                <Td><span className="line-clamp-2 block w-44 whitespace-normal leading-snug text-ink-muted" title={r.description ?? undefined}>{r.description ?? "—"}</span></Td>
                <Td align="right" className="text-ink-muted">{formatCount(r.pos)} · {formatCount(r.orders)}{r.open_orders > 0 ? ` (${formatCount(r.open_orders)} open)` : ""}</Td>
                <Td align="right" className="font-semibold text-ink">{money(r.revenue_ordered)}</Td>
                <Td align="right" className="font-semibold text-green-700">{Number(r.revenue_delivered) === 0 ? <span className="font-normal text-neutral-300">—</span> : money(r.revenue_delivered)}</Td>
                {COLUMNS.map((c) => (
                  <Td key={c.key} align="right" className={`${c.key === "pending" && Number(r.pending) > 0 ? "font-semibold text-amber-700" : c.tone ?? "text-ink"}`}>
                    {Number(r[c.key]) === 0 ? <span className="text-neutral-300">—</span> : formatQty(r[c.key] as string)}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
