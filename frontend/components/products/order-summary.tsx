"use client";

import { useState } from "react";
import type { OrderSummaryPage } from "@/lib/types";
import { formatCount, formatDate, formatDifference, formatQty } from "@/lib/format";
import { useApi, useDebounced } from "../use-api";
import { useBusiness, BusinessPicker } from "../business-switch";
import { CheckIcon, DownloadIcon } from "../icons";
import { Dropdown } from "../orders/orders-menu";
import { Button } from "../ui/button";
import { DatePicker } from "../ui/date-picker";

import { Alert, EmptyState } from "../ui/feedback";
import { ListToolbar } from "../ui/list-toolbar";
import { Panel } from "../ui/panel";
import { SearchInput } from "../ui/search-input";
import { TableSkeleton } from "../ui/skeleton";
import { ProductPanel } from "./product-panel";


// Laid out like SASH's "DTP - Order Summary" Excel (in the app's font, which reads better than Excel's narrow one): its colours (light orange part columns, light blue day columns),
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
// The day columns share the width left of the part columns so about 3½ days show at a time (the half one hints at more
// to scroll to): each a tenth and a half of what is left (window less sidebar, margins and part columns), at least 96px.
const DAY_WIDTH = "min-w-[max(84px,calc((100vw_-_760px)_/_10.5))]";
const DAY_COLS = { firm: DAY_WIDTH, addition: DAY_WIDTH, forecast: DAY_WIDTH };

// A quantity as the Excel's "0" number format shows it: a whole number, no separators.
const plain = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "" : String(Number(value)));
// "2026-11-05" -> "05.11.2026", as in the Excel's first row.
const excelDate = (iso: string) => iso.split("-").reverse().join(".");
// Addition cell fill, as the Excel's conditional format: green above 0, red below 0.
const additionFill = (value: string) => (Number(value) > 0 ? "bg-[#92D050] font-bold text-black" : Number(value) < 0 ? "bg-[#FF0000] font-bold text-white" : `bg-white ${HOVER}`);
// 0 is shown, as in the Excel, but faded so the quantities that matter stand out.
const zeroFade = (value: string) => (Number(value) === 0 ? "text-neutral-400" : "");

// The days shown at first: the last 30.
const RECENT_DAYS = 30;

// Products page, "Order summary" tab, like SASH's "Order Summary" Excel: for the business shown (DTP or GMBH), one row per
// part and, for every day with an upload (newest first; the day's last upload), the part's Firm (Firm and Order rows),
// Addition (Firm less the previous day's Firm) and Forecast quantity. From / To limit the days; Export downloads the
// same as an .xlsx file. In "All" it asks to choose a business. Every part at once (no pages); From starts RECENT_DAYS
// back (cleared, every day shows). The same on Products → Order summary and Orders → Order summary.
// `canEdit`: the product panel a part opens (click its row) allows editing.

// The day `days` ago (local), as yyyy-mm-dd.
function daysAgo(days: number) {
  const day = new Date();
  day.setDate(day.getDate() - days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

// The two ways to choose the days shown.
const MODES = {
  range: { label: "Date range", hint: "Every day from one date to another" },
  compare: { label: "Compare dates", hint: "Only the dates you pick, side by side" },
} as const;

// Quick ranges for From / To (To blank = up to the newest day).
const PRESETS = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }] as const;

export function OrderSummaryPanel({ canEdit = false }: { canEdit?: boolean }) {
  // The product whose panel is open (clicked part).
  const [productId, setProductId] = useState<number | null>(null);
  const { view: business } = useBusiness();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [from, setFrom] = useState(() => daysAgo(RECENT_DAYS));
  const [to, setTo] = useState("");
  // Compare dates: chosen days only (any number), side by side; Addition is then the change since the chosen day before.
  const [dates, setDates] = useState<string[]>([]);
  // Date range (From / To) or Compare dates (chosen days side by side): one at a time.
  const [mode, setMode] = useState<"range" | "compare">("range");
  const comparing = mode === "compare" && dates.length > 0;
  const query = comparing ? { q, dates: [...dates].sort().join(",") } : { q, from: from || undefined, to: to || undefined };
  const { data, error, loading } = useApi<OrderSummaryPage>(business === "all" ? null : "/api/products/order_summary", {
    ...query, all: 1,
  });
  // The export link carries the business itself (a download sends no X-Business header).
  const exportQuery = new URLSearchParams(Object.entries({ business, ...query }).filter((e): e is [string, string] => !!e[1]));
  const ranged = from !== "" || to !== "" || comparing;
  const clearAll = () => { setSearch(""); setFrom(""); setTo(""); setDates([]); };

  return (
    <Panel flush>
      {/* Filters on one line: Business, Show, then From / To and quick ranges (or the dates to compare). */}
      <div className="border-b border-line bg-neutral-50/60 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <BusinessPicker alignLeft />
          {business !== "all" && (<>
            {/* Which days are shown: a date range or chosen dates to compare (the same dropdown as Business). */}
            <Dropdown width="w-72" alignLeft label={<><span className="text-ink-muted">Show</span><span className="font-semibold text-ink">{MODES[mode].label}</span></>}>
              {(close) => (
                <div className="py-1">
                  {(Object.keys(MODES) as (keyof typeof MODES)[]).map((key) => (
                    <button key={key} type="button" role="menuitemradio" aria-checked={mode === key} onClick={() => { close(); setMode(key); }}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-50 ${mode === key ? "font-semibold text-ink" : "text-ink-muted"}`}>
                      <span>{MODES[key].label}<span className="block text-xs font-normal text-ink-faint">{MODES[key].hint}</span></span>
                      {mode === key && <CheckIcon size={14} className="shrink-0 text-ink" />}
                    </button>
                  ))}
                </div>
              )}
            </Dropdown>
            {mode === "range" ? (<>
              <div className="space-y-1.5">
                <label htmlFor="order-summary-from" className="block text-sm font-medium text-ink">From</label>
                <DatePicker id="order-summary-from" value={from} onChange={setFrom} min={data?.first_date ?? undefined}
                            max={to || (data?.last_date ?? undefined)} placeholder="Oldest day" clearable className="w-48" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="order-summary-to" className="block text-sm font-medium text-ink">To</label>
                <DatePicker id="order-summary-to" value={to} onChange={setTo} min={from || (data?.first_date ?? undefined)}
                            max={data?.last_date ?? undefined} placeholder="Newest day" clearable className="w-48" />
              </div>
              {/* Quick ranges, on the same line. */}
              <div className="flex h-10 flex-wrap items-center gap-1.5">
                {[...PRESETS.map((p) => ({ label: `Last ${p.label}`, from: daysAgo(p.days) })), { label: "All days", from: "" }].map((p) => {
                  const on = !to && from === p.from;
                  return (
                    <button key={p.label} type="button" onClick={() => { setFrom(p.from); setTo(""); }} aria-pressed={on}
                            className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
                              on ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-white text-ink-muted hover:border-neutral-300 hover:text-ink"}`}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </>) : (
              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-ink">Dates to compare</span>
                <CompareDates options={data?.available_dates ?? []} value={dates} onChange={setDates} />
              </div>
            )}
          </>)}
        </div>
      </div>

      {business === "all" ? (
        <EmptyState title="Choose DTP or GMBH"
                    description="The order summary shows the files of one business. Pick DTP or GMBH in the Business menu above." />
      ) : (<>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} part${data.meta.total === 1 ? "" : "s"} · ${formatCount(data.days.length)} day${data.days.length === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search order summary" placeholder="Search part number or description" value={search}
                       onSearch={setSearch} className="w-full sm:w-72" />
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
        {comparing && data && data.days.length > 1 && (
          <p className="border-b border-line bg-tint-violet/40 px-4 py-2 text-sm text-ink sm:px-6">
            Comparing {data.days.map((d) => excelDate(d.date)).join(" with ")}: under each date, the <b>vs</b> column is how much its
            Firm went up (green) or down (red) since the next date. Parts that did not change show 0.
          </p>
        )}
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
              <table className="border-separate border-spacing-0 text-base leading-tight text-black">
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
                    {data.days.map((day, i) => (
                      // Comparing dates: each Addition is the change since the next chosen date (to its right).
                      <DayHeadings key={day.date} addition={comparing ? (data.days[i + 1] ? `vs ${excelDate(data.days[i + 1].date).slice(0, 5)}` : "vs day before") : "Addition"} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row) => (
                    <tr key={row.part_number} onClick={row.product_id ? () => setProductId(row.product_id!) : undefined}
                        title={row.product_id ? `Open ${row.part_number}` : undefined}
                        className={`group h-7 ${row.product_id ? "cursor-pointer" : ""} ${row.product_id === productId ? "[&>td]:!bg-tint-violet" : ""}`}>
                      <td className={`${COLS.serial.sticky} ${COLS.serial.width} z-[5] border-l ${GRID} ${ORANGE} ${HOVER} px-2 text-center text-neutral-600`}>{row.serial}</td>
                      <td className={`${COLS.part.sticky} ${COLS.part.width} z-[5] ${GRID} ${ORANGE} ${HOVER} truncate px-2 font-semibold ${row.product_id ? "text-accent underline decoration-accent/30 underline-offset-2" : ""}`} title={row.part_number}>{row.part_number}</td>
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
          </div>
        ) : null}
      </>)}
      {productId !== null && <ProductPanel key={productId} productId={productId} canEdit={canEdit} onClose={() => setProductId(null)} />}
    </Panel>
  );
}

// Second header row of a day, under its date.
function DayHeadings({ addition = "Addition" }: { addition?: string }) {
  return (
    <>
      <th className={`sticky top-7 z-20 ${DAY_COLS.firm} ${GRID} ${DAY_EDGE} ${BLUE} px-2 text-center font-bold`}>Firm</th>
      <th className={`sticky top-7 z-20 ${DAY_COLS.addition} ${GRID} ${BLUE} px-2 text-center font-bold`}>{addition}</th>
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

// Compare dates: pick days on a calendar (only days with an upload can be picked); each chosen day shows as a chip with
// its own ✕, and "Clear all" goes back to From / To.
function CompareDates({ options, value, onChange }: {
  options: { date: string; filename: string; version: string | null }[]; value: string[]; onChange: (dates: string[]) => void;
}) {
  const days = options.map((o) => o.date);
  const add = (date: string) => { if (date && !value.includes(date)) onChange([...value, date]); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DatePicker value="" onChange={add} allowed={days} marked={value} min={days[days.length - 1]} max={days[0]}
                  placeholder={value.length ? "Add a date" : "Choose dates"} aria-label="Add a date to compare" className="w-44" />
      {[...value].sort().reverse().map((date) => (
        <span key={date} className="inline-flex h-8 items-center gap-1 rounded-full border border-accent/30 bg-accent/10 pl-3 pr-1 text-sm font-medium text-accent">
          <span className="tabular">{formatDate(date)}</span>
          <button type="button" onClick={() => onChange(value.filter((d) => d !== date))} aria-label={`Remove ${formatDate(date)}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-accent/70 transition-colors hover:bg-accent/15 hover:text-accent">✕</button>
        </span>
      ))}
      {value.length > 1 && (
        <button type="button" onClick={() => onChange([])} className="text-sm font-medium text-ink-muted hover:text-ink hover:underline">Clear all</button>
      )}
    </div>
  );
}
