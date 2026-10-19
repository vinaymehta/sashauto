// Time graphs of the dashboard: values per date grouped into weeks or months (`groupByPeriod`), drawn by TimeChart,
// with the Month / 6 months / Year switch (`PeriodToggle`).

export type Period = "month" | "6m" | "year";
export const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "Month" }, { key: "6m", label: "6 months" }, { key: "year", label: "Year" },
];

export interface Bar { key: string; label: string; sublabel?: string; title: string; values: number[]; tone?: "bad" }

const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const parse = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d!); };
const short = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Groups `points` (ISO date + one value per series) into bars:
//   month  this calendar month by week (1–7, 8–14, 15–21, 22–28, 29–end)
//   6m     six months: from this month on (`ahead`), or the five before and this one
//   year   twelve months from this month (`ahead`), or the financial year so far (from `yearStart`)
// Points before the first bar go to an "Overdue" bar first when `earlier` is set (open orders), else are left out;
// points after the last bar are left out.
export function groupByPeriod(points: { date: string; values: number[] }[], period: Period, opts: {
  today?: Date; ahead?: boolean; yearStart?: string; earlier?: boolean; series: number;
}): Bar[] {
  const today = opts.today ?? new Date();
  const start = monthStart(today);
  let ranges: { from: Date; to: Date; label: string; sublabel?: string; title: string }[];
  if (period === "month") {
    const end = addMonths(start, 1);
    ranges = [1, 8, 15, 22, 29].map((day) => new Date(start.getFullYear(), start.getMonth(), day)).filter((d) => d < end).map((from) => {
      const to = new Date(Math.min(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7).getTime(), end.getTime()));
      const last = new Date(to.getTime() - 86_400_000);
      return { from, to, label: `${from.getDate()}–${last.getDate()}`, sublabel: from.toLocaleDateString("en-GB", { month: "short" }), title: `${short(from)} – ${short(last)} ${from.getFullYear()}` };
    });
  } else {
    const first = period === "6m" ? (opts.ahead ? start : addMonths(start, -5))
      : opts.ahead ? start : monthStart(opts.yearStart ? parse(opts.yearStart) : addMonths(start, -11));
    const count = period === "6m" ? 6 : opts.ahead ? 12 : (start.getFullYear() - first.getFullYear()) * 12 + start.getMonth() - first.getMonth() + 1;
    ranges = Array.from({ length: count }, (_, i) => {
      const from = addMonths(first, i);
      return { from, to: addMonths(from, 1), label: from.toLocaleDateString("en-GB", { month: "short" }), sublabel: String(from.getFullYear()),
               title: from.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
    });
  }

  const zero = () => Array.from({ length: opts.series }, () => 0);
  const bars: Bar[] = ranges.map((r) => ({ key: r.from.toISOString(), label: r.label, sublabel: r.sublabel, title: r.title, values: zero() }));
  const before: number[] = zero();
  for (const p of points) {
    const d = parse(p.date);
    const i = ranges.findIndex((r) => d >= r.from && d < r.to);
    const target = i >= 0 ? bars[i]!.values : d < ranges[0]!.from && opts.earlier ? before : null;
    if (target) p.values.forEach((v, j) => { target[j] = (target[j] ?? 0) + v; });
  }
  if (opts.earlier && before.some((v) => v)) {
    bars.unshift({ key: "earlier", label: "Overdue", sublabel: `before ${short(ranges[0]!.from)}`, title: `Ship date before ${short(ranges[0]!.from)} ${ranges[0]!.from.getFullYear()}`, values: before, tone: "bad" });
  }
  return bars;
}

// Month / 6 months / Year switch for a graph.
export function PeriodToggle({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" className="inline-flex shrink-0 self-start rounded-md border border-line bg-neutral-50 p-0.5 text-xs font-medium">
      {PERIODS.map((p) => (
        <button key={p.key} type="button" role="radio" aria-checked={value === p.key} onClick={() => onChange(p.key)}
                className={`rounded px-2.5 py-1 transition-colors ${value === p.key ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-muted hover:text-ink"}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
