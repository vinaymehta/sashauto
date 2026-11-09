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
import { Pagination } from "../ui/table";


// Laid out like SASH's "DTP - Order Summary" Excel: its colours (light orange part columns, light blue day columns),
// thin grid lines (a darker rule between days), centred plain numbers (no thousands separators, 0 shown as 0), dd.mm.yyyy dates and the
// Addition cell filled green above 0 and red below 0. As the Excel's frozen panes, the two header rows stay on top and
// the part columns on the left (S No and Part Number always, Description and MOQ from lg up).
const ORANGE = "bg-[#FBE3D6]";
const BLUE = "bg-[#83CBEB]";
const GRID = "border-r border-b border-neutral-300";
// The left rule of each day's Firm column: darker, so each day's three columns read as one group.
const DAY_EDGE = "border-l-2 border-l-neutral-500";
// The last sticky part column's right rule, darker too.
const PART_EDGE = "lg:border-r-2 lg:border-r-neutral-500";
// The row under the pointer, sticky part columns included.
const HOVER = "group-hover:bg-[#FFF4C2]";
// Fixed widths (from the Excel's column widths) so each sticky column knows where the next one starts.
const COLS = {
  serial: { width: "w-[52px] min-w-[52px] max-w-[52px]", sticky: "sticky left-0" },
  part: { width: "w-[120px] min-w-[120px] max-w-[120px]", sticky: "sticky left-[52px]" },
  description: { width: "w-[216px] min-w-[216px] max-w-[216px]", sticky: "lg:sticky lg:left-[172px]" },
  moq: { width: "w-[60px] min-w-[60px] max-w-[60px]", sticky: "lg:sticky lg:left-[388px]" },
};
const DAY_COLS = { firm: "min-w-[62px]", addition: "min-w-[72px]", forecast: "min-w-[68px]" };

// A quantity as the Excel's "0" number format shows it: a whole number, no separators.
const plain = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "" : String(Number(value)));
// "2026-11-05" -> "05.11.2026", as in the Excel's first row.
const excelDate = (iso: string) => iso.split("-").reverse().join(".");
// Addition cell fill, as the Excel's conditional format: green above 0, red below 0.
const additionFill = (value: string) => (Number(value) > 0 ? "bg-[#92D050] font-bold text-black" : Number(value) < 0 ? "bg-[#FF0000] font-bold text-white" : `bg-white ${HOVER}`);
// 0 is shown, as in the Excel, but faded so the quantities that matter stand out.
const zeroFade = (value: string) => (Number(value) === 0 ? "text-neutral-400" : "");

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
            <div className="max-h-[calc(100vh-14rem)] overflow-auto">
              <table className="border-separate border-spacing-0 text-[15px] leading-tight text-black [font-family:'Aptos_Narrow','Arial_Narrow',Calibri,Arial,sans-serif]">
                <thead className="whitespace-nowrap">
                  <tr className="h-7">
                    {/* Above the part columns, empty as in the Excel. */}
                    <th className={`${COLS.serial.sticky} top-0 z-30 border-l border-t ${GRID} ${ORANGE}`} />
                    <th className={`${COLS.part.sticky} top-0 z-30 border-t ${GRID} ${ORANGE}`} />
                    <th className={`${COLS.description.sticky} top-0 z-30 border-t ${GRID} ${ORANGE}`} />
                    <th className={`${COLS.moq.sticky} top-0 z-30 border-t ${GRID} ${PART_EDGE} ${ORANGE}`} />
                    {data.days.map((day) => (
                      <th key={day.date} colSpan={3} title={`${day.filename}${day.version ? ` · ${day.version}` : ""}`}
                          className={`sticky top-0 z-20 border-t ${GRID} ${DAY_EDGE} ${BLUE} px-2 text-center font-bold tracking-wide`}>
                        {excelDate(day.date)}
                      </th>
                    ))}
                  </tr>
                  <tr className="h-7">
                    <th className={`${COLS.serial.sticky} ${COLS.serial.width} top-7 z-30 border-l ${GRID} ${ORANGE} px-2 text-left font-bold`}>S No</th>
                    <th className={`${COLS.part.sticky} ${COLS.part.width} top-7 z-30 ${GRID} ${ORANGE} px-2 text-left font-bold`}>Part Number</th>
                    <th className={`${COLS.description.sticky} ${COLS.description.width} top-7 z-30 ${GRID} ${ORANGE} px-2 text-left font-bold`}>Description</th>
                    <th className={`${COLS.moq.sticky} ${COLS.moq.width} top-7 z-30 ${GRID} ${PART_EDGE} ${ORANGE} px-2 text-center font-bold`}>MOQ</th>
                    {data.days.map((day) => (
                      <DayHeadings key={day.date} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row) => (
                    <tr key={row.part_number} className="group h-[26px]">
                      <td className={`${COLS.serial.sticky} ${COLS.serial.width} z-[5] border-l ${GRID} ${ORANGE} ${HOVER} px-2 text-center text-neutral-600`}>{row.serial}</td>
                      <td className={`${COLS.part.sticky} ${COLS.part.width} z-[5] ${GRID} ${ORANGE} ${HOVER} truncate px-2 font-semibold`} title={row.part_number}>{row.part_number}</td>
                      <td className={`${COLS.description.sticky} ${COLS.description.width} z-[5] ${GRID} ${ORANGE} ${HOVER} truncate px-2`}
                          title={row.description ?? undefined}>{row.description ?? ""}</td>
                      <td className={`${COLS.moq.sticky} ${COLS.moq.width} z-[5] ${GRID} ${PART_EDGE} ${ORANGE} ${HOVER} px-2 text-center`}>{plain(row.moq)}</td>
                      {row.values.map(([firm, addition, forecast], i) => (
                        <DayCells key={data.days[i]?.date ?? i} firm={firm} addition={addition} forecast={forecast} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="parts" />
          </div>
        ) : null}
      </>)}
    </Panel>
  );
}

// Second header row of a day, under its date.
function DayHeadings() {
  return (
    <>
      <th className={`sticky top-7 z-20 ${DAY_COLS.firm} ${GRID} ${DAY_EDGE} ${BLUE} px-2 text-center font-bold`}>Firm</th>
      <th className={`sticky top-7 z-20 ${DAY_COLS.addition} ${GRID} ${BLUE} px-2 text-center font-bold`}>Addition</th>
      <th className={`sticky top-7 z-20 ${DAY_COLS.forecast} ${GRID} ${BLUE} px-2 text-center font-bold`}>Forecast</th>
    </>
  );
}

function DayCells({ firm, addition, forecast }: { firm: string; addition: string; forecast: string }) {
  return (
    <>
      <td className={`${GRID} ${DAY_EDGE} bg-white ${HOVER} px-2 text-center font-semibold tabular ${zeroFade(firm)}`}>{plain(firm)}</td>
      <td className={`${GRID} ${additionFill(addition)} px-2 text-center tabular ${Number(addition) === 0 ? "text-neutral-400" : ""}`}>{plain(addition)}</td>
      <td className={`${GRID} bg-white ${HOVER} px-2 text-center tabular ${zeroFade(forecast)}`}>{plain(forecast)}</td>
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
