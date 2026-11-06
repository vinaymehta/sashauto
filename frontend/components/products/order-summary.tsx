"use client";

import { useState } from "react";
import type { OrderSummaryPage } from "@/lib/types";
import { formatCount, formatDate, formatDifference, formatQty } from "@/lib/format";
import { useApi, useDebounced } from "../use-api";
import { useBusiness, BusinessPicker } from "../business-switch";
import { useListQuery } from "../use-list-query";
import { DownloadIcon } from "../icons";
import { Button } from "../ui/button";
import { DatePicker } from "../ui/date-picker";
import { Alert, EmptyState } from "../ui/feedback";
import { ListToolbar } from "../ui/list-toolbar";
import { Panel } from "../ui/panel";
import { SearchInput } from "../ui/search-input";
import { TableSkeleton } from "../ui/skeleton";
import { Pagination, Table, Td, Th } from "../ui/table";

const dash = <span className="text-neutral-300">—</span>;

// The four part columns stay on the left while the days scroll sideways (Description and MOQ from lg up). Each has a
// fixed width so the next one knows where to stick: S No 4.75rem (pl-6 + 2.5rem + pr-3), Part Number 8.5rem,
// Description 15.5rem, MOQ 5.5rem. The header cells sit above the body cells, the top-left ones above both.
const STICKY = {
  serial: "sticky left-0",
  part: "sticky left-[4.75rem]",
  description: "lg:sticky lg:left-[13.25rem]",
  moq: "lg:sticky lg:left-[28.75rem]",
};
const corner = "z-30!";
const body = "z-[5] bg-surface group-hover:bg-canvas"; // the row hover shows through the sticky cells too
// Divider after the last sticky column, and the header's bottom rule (Table stickyHeader) on the MOQ heading.
const edge = "lg:shadow-[inset_-1px_0_0_var(--color-line)]";
const edgeTh = "lg:shadow-[inset_-1px_0_0_var(--color-line),inset_0_-1px_0_var(--color-line)]!";

// Zeros fade to a dash so the quantities that matter stand out.
const qtyOrDash = (value: string) => (Number(value) === 0 ? dash : formatQty(value));
// Addition as in SASH's Excel: green above 0, red below 0 (as a pill), nothing for 0.
const additionPill = (value: string) => {
  const n = Number(value);
  if (n === 0) return dash;
  return (
    <span className={`inline-flex min-w-12 justify-center rounded-full px-2 py-0.5 text-sm font-semibold tabular ${
      n > 0 ? "bg-[#92D050] text-neutral-900" : "bg-[#FF0000] text-white"
    }`}>{formatDifference(value)}</span>
  );
};
// Every other day is shaded, so each day's three columns read as one group.
const dayShade = (index: number) => (index % 2 === 1 ? "bg-neutral-50/70" : "");

// Products page, "Order summary" tab, like SASH's "Order Summary" Excel: for the business shown (DTP or GMBH), one row per
// part and, for every day with an upload (newest first; the day's last upload), the part's Firm (Firm and Order rows),
// Addition (Firm less the previous day's Firm) and Forecast quantity. From / To limit the days; Export downloads the
// same as an .xlsx file. In "All" it asks to choose a business.
export function OrderSummaryPanel() {
  const { view: business } = useBusiness();
  const list = useListQuery({}, 50);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = { q, from: from || undefined, to: to || undefined };
  const { data, error, loading } = useApi<OrderSummaryPage>(business === "all" ? null : "/api/products/order_summary", {
    ...query, page: list.page, per_page: list.perPage,
  });
  // The export link carries the business itself (a download sends no X-Business header).
  const exportQuery = new URLSearchParams(Object.entries({ business, ...query }).filter((e): e is [string, string] => !!e[1]));
  const ranged = from !== "" || to !== "";
  const clearAll = () => { setSearch(""); setFrom(""); setTo(""); list.resetPage(); };
  const pickDate = (set: (value: string) => void) => (value: string) => { set(value); list.resetPage(); };

  return (
    <Panel flush>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink">Business</span>
          <BusinessPicker />
        </div>
        {business !== "all" && (<>
          <div className="space-y-1.5">
            <label htmlFor="order-summary-from" className="block text-sm font-medium text-ink">From</label>
            <DatePicker id="order-summary-from" value={from} onChange={pickDate(setFrom)} min={data?.first_date ?? undefined}
                        max={to || (data?.last_date ?? undefined)} placeholder="Oldest day" clearable className="w-44" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="order-summary-to" className="block text-sm font-medium text-ink">To</label>
            <DatePicker id="order-summary-to" value={to} onChange={pickDate(setTo)} min={from || (data?.first_date ?? undefined)}
                        max={data?.last_date ?? undefined} placeholder="Newest day" clearable className="w-44" />
          </div>
        </>)}
      </div>

      {business === "all" ? (
        <EmptyState title="Choose DTP or GMBH"
                    description="The order summary shows the files of one business. Pick DTP or GMBH in the Business menu above." />
      ) : (<>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} part${data.meta.total === 1 ? "" : "s"} · ${formatCount(data.days.length)} day${data.days.length === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search order summary" placeholder="Search part number or description" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          {/* The same days and search as shown, every part, laid out like SASH's Excel. */}
          {data && data.meta.total > 0 && (
            <a href={`/api/products/order_summary/export?${exportQuery}`} download
               className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-ink transition-colors hover:border-neutral-400 hover:bg-subtle">
              <DownloadIcon size={15} className="text-ink-muted" />
              Export
            </a>
          )}
        </ListToolbar>
        {data?.latest && data.data.length > 0 && <LatestDay latest={data.latest} />}
        {error ? (
          <div className="p-4"><Alert title="Could not load the order summary">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={10} />
        ) : data && (data.data.length === 0 || data.days.length === 0) ? (
          <EmptyState
            title={q || ranged ? "No parts match" : "No uploads yet"}
            description={q || ranged ? "Try a different search or date range." : "The order summary fills in with the first upload of this business."}
            action={q || ranged ? <Button size="sm" onClick={clearAll}>Clear search and dates</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            <Table dense stickyHeader>
              <thead>
                <tr>
                  <Th rowSpan={2} align="right" className={`${STICKY.serial} ${corner}`}><span className="block w-10">S No</span></Th>
                  <Th rowSpan={2} className={`${STICKY.part} ${corner}`}><span className="block w-28">Part Number</span></Th>
                  <Th rowSpan={2} className={`${STICKY.description} ${corner}`}><span className="block w-56">Description</span></Th>
                  <Th rowSpan={2} align="right" className={`${STICKY.moq} ${corner} ${edgeTh}`}><span className="block w-16">MOQ</span></Th>
                  {data.days.map((day, i) => (
                    <Th key={day.date} colSpan={3} align="center" className="border-l border-line"
                        title={`${day.filename}${day.version ? ` · ${day.version}` : ""}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {formatDate(day.date)}
                        {i === 0 && day.date === data.last_date && (
                          <span className="rounded-full bg-accent px-1.5 py-px text-2xs font-semibold normal-case tracking-normal text-white">Latest</span>
                        )}
                      </span>
                    </Th>
                  ))}
                </tr>
                <tr>
                  {data.days.map((day, i) => (
                    <DayHeadings key={day.date} shade={dayShade(i)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.part_number} className="group hover:bg-canvas">
                    <Td align="right" className={`${STICKY.serial} ${body} text-ink-muted`}><span className="block w-10">{row.serial}</span></Td>
                    <Td className={`${STICKY.part} ${body} font-medium`}><span className="block w-28 truncate" title={row.part_number}>{row.part_number}</span></Td>
                    <Td className={`${STICKY.description} ${body} text-ink-muted`}>
                      <span className="block w-56 truncate" title={row.description ?? undefined}>{row.description ?? dash}</span>
                    </Td>
                    <Td align="right" className={`${STICKY.moq} ${body} ${edge}`}><span className="block w-16">{row.moq ? formatQty(row.moq) : dash}</span></Td>
                    {row.values.map(([firm, addition, forecast], i) => (
                      <DayCells key={data.days[i]?.date ?? i} firm={firm} addition={addition} forecast={forecast} shade={dayShade(i)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="parts" />
          </div>
        ) : null}
      </>)}
    </Panel>
  );
}

// Second header row of a day: under its date, below the first header row (h-10).
function DayHeadings({ shade }: { shade: string }) {
  return (
    <>
      <Th align="right" className={`top-10! border-l border-line ${shade}`}>Firm</Th>
      <Th align="center" className={`top-10! ${shade}`}>Addition</Th>
      <Th align="right" className={`top-10! ${shade}`}>Forecast</Th>
    </>
  );
}

function DayCells({ firm, addition, forecast, shade }: { firm: string; addition: string; forecast: string; shade: string }) {
  return (
    <>
      <Td align="right" className={`border-l border-line-soft font-medium ${shade}`}>{qtyOrDash(firm)}</Td>
      <Td align="center" className={shade}>{additionPill(addition)}</Td>
      <Td align="right" className={`text-ink-muted ${shade}`}>{qtyOrDash(forecast)}</Td>
    </>
  );
}

// The newest day at a glance, over every part that matches: its Firm, the Qty added and taken off since the day
// before, how many parts changed, and its Forecast.
function LatestDay({ latest }: { latest: NonNullable<OrderSummaryPage["latest"]> }) {
  const tiles: { label: string; value: string; tone: string }[] = [
    { label: "Firm", value: formatQty(latest.firm), tone: "text-ink" },
    { label: "Added", value: formatDifference(latest.added), tone: Number(latest.added) > 0 ? "text-inc" : "text-ink-faint" },
    { label: "Taken off", value: formatDifference(latest.reduced), tone: Number(latest.reduced) < 0 ? "text-dec" : "text-ink-faint" },
    { label: "Parts changed", value: formatCount(latest.changed), tone: latest.changed > 0 ? "text-accent" : "text-ink-faint" },
    { label: "Forecast", value: formatQty(latest.forecast), tone: "text-ink-muted" },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-3 border-b border-line bg-gradient-to-r from-tint-violet/60 via-white to-white px-4 py-3 sm:px-6">
      <div className="flex flex-col justify-center pr-2">
        <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">Latest day</span>
        <span className="text-sm font-semibold text-ink">{formatDate(latest.date)}</span>
      </div>
      {tiles.map((t) => (
        <div key={t.label} className="min-w-28 rounded-lg border border-line bg-white px-3 py-2 shadow-card">
          <span className="block text-xs text-ink-muted">{t.label}</span>
          <span className={`block text-lg font-semibold tabular ${t.tone}`}>{t.value}</span>
        </div>
      ))}
    </div>
  );
}
