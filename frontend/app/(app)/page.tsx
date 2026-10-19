"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { DashboardOverview, DateAmount, PipelineStatus, Stats } from "@/lib/types";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import { groupByPeriod, PeriodToggle, StackedBars, type Period } from "@/components/charts/month-bars";
import { PieChart } from "@/components/charts/pie-chart";
import { AlertIcon, BoxIcon, CalendarIcon, CheckIcon, FileIcon, TruckIcon, UploadIcon } from "@/components/icons";
import { useApi } from "@/components/use-api";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { TINTS, type Tint } from "@/components/ui/tint";

// Whole amounts with the currency sign (INR with Indian digit grouping); `compact` writes $104K / ₹51L.
function formatMoney(amount: string | number, currency: string, compact = false) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency, maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard",
  }).format(Number(amount));
}
const usd = (v: string | number, compact = false) => formatMoney(v, "USD", compact);
const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
const ordersText = (n: number, missing: number) => `${plural(n, "order")}${missing ? ` · ${formatCount(missing)} without a price` : ""}`;

const STATUS: Record<PipelineStatus, { label: string; hint: string; color: string }> = {
  none: { label: "No status", hint: "Not yet received at SASH Faridabad", color: "bg-neutral-400" },
  received: { label: "Received", hint: "At SASH Faridabad", color: "bg-tint-violet-ink" },
  dispatched: { label: "Dispatched", hint: "Shipped from Faridabad", color: "bg-tint-amber-ink" },
  inbound: { label: "Inbound", hint: "At SASH US, to deliver to Deere", color: "bg-series-a" },
};
const AGE = {
  red: { label: "90+ days", color: "bg-age-red-ink" },
  yellow: { label: "60–89 days", color: "bg-age-yellow-ink" },
  green: { label: "30–59 days", color: "bg-age-green-ink" },
  none: { label: "Under 30 days or no Firm Date", color: "bg-neutral-300" },
} as const;

function Card({ title, description, info, action, children, className = "" }: {
  title: string; description?: string; info?: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card ${className}`}>
      <header className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-ink">{title}{info && <InfoTip label={`About ${title}`}>{info}</InfoTip>}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        {action}
      </header>
      <div className="flex-1 px-6 pb-6">{children}</div>
    </section>
  );
}

// A figure card: tinted icon and label, the value (`extra`: amounts in other currencies), a detail line and, below,
// optional content (e.g. a progress bar). `size="lg"` for the three money figures. `href` makes it a link.
function StatCard({ label, value, extra, detail, icon, tint, href, size = "md", tone, info, children }: {
  label: string; value: string; extra?: string; detail?: ReactNode; icon: ReactNode; tint: Tint; href?: string;
  size?: "md" | "lg"; tone?: "bad"; info?: ReactNode; children?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
        <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-md ${TINTS[tint].chip}`}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {info && <InfoTip label={`About ${label}`}>{info}</InfoTip>}
      </div>
      <p className={`tabular mt-3 font-bold tracking-tight ${size === "lg" ? "text-3xl" : "text-2xl"} ${tone === "bad" ? "text-age-red-ink" : "text-neutral-900"}`}>{value}</p>
      {extra && <p className="tabular mt-0.5 text-sm font-semibold text-ink">+ {extra}</p>}
      {detail && <p className="mt-1 text-sm text-ink-muted">{detail}</p>}
      {children}
    </>
  );
  const className = `block rounded-lg border border-line bg-gradient-to-b ${TINTS[tint].wash} via-white to-white px-6 py-5 shadow-card`;
  return href
    ? <Link href={href} className={`${className} transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300`}>{body}</Link>
    : <div className={className}>{body}</div>;
}

export default function DashboardPage() {
  const { data, error, loading } = useApi<Stats>("/api/stats");

  const header = (
    <PageHeader
      title="Dashboard"
      description="Open orders with Deere and vendors, where they stand, and Deere's spend with SASH this financial year."
      actions={<Link href="/orders"><Button variant="primary"><UploadIcon size={15} />Upload new file</Button></Link>}
    />
  );

  if (error) return <>{header}<Alert title="Could not load the dashboard">{error.message}</Alert></>;
  if (loading && !data) return <>{header}<DashboardSkeleton /></>;
  if (!data) return null;

  const { latest, totals, money, overview } = data;
  if (!latest) {
    return (
      <>
        {header}
        <section className="rounded-lg border border-line bg-surface shadow-card">
          <EmptyState title="No uploads yet" description="Upload the first Supplier Requirements export to see the order values."
                      action={<Link href="/orders"><Button variant="primary">Go to Orders</Button></Link>} />
        </section>
      </>
    );
  }

  const attention = [
    overview.kpis.overdue.count > 0 && { text: `${plural(overview.kpis.overdue.count, "open order")} past the ship date`, href: "/orders" },
    totals.open_conflicts > 0 && { text: `${totals.open_conflicts} Commodity Type conflict${totals.open_conflicts === 1 ? "" : "s"} to review`, href: "/products?conflicts=open" },
    totals.emails_failed > 0 && { text: `${totals.emails_failed} email${totals.emails_failed === 1 ? "" : "s"} failed to send`, href: "/orders" },
    totals.in_progress > 0 && { text: `${totals.in_progress} upload${totals.in_progress === 1 ? " is" : "s are"} processing`, href: "/orders" },
  ].filter(Boolean) as { text: string; href: string }[];

  const { kpis } = overview;
  const sale = money.open_sale;
  const supplier = money.open_supplier;
  const ytd = money.ytd_customer_spend;

  return (
    <>
      {header}
      <div className="space-y-5">
        {attention.length > 0 && (
          <div className="flex animate-fade-in flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-neutral-300 border-l-4 border-l-neutral-900 bg-white px-6 py-4 text-sm shadow-card">
            <span className="inline-flex items-center gap-2 font-semibold text-neutral-900"><AlertIcon size={15} />Needs attention</span>
            {attention.map((a) => (
              <Link key={a.text} href={a.href} className="text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 hover:decoration-neutral-900">{a.text}</Link>
            ))}
          </div>
        )}

        {/* Money (Dashboard::Money). */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard size="lg" label="Total Open Value (Sale)" info={<>Value of Deere orders <b>not yet delivered</b>: Firm and Order orders of the latest upload and manual orders, without a &quot;Delivered to Deere&quot; (Outbound) status. Value = Qty × Unit Price ÷ 100 (Deere prices are per 100 pcs), in USD. Forecast is not counted.</>} icon={<BoxIcon size={16} />} tint="violet" href="/orders"
                    value={formatMoney(sale.amount, sale.currency)}
                    detail={`${ordersText(sale.orders, sale.without_price)} not yet delivered to Deere`} />
          <StatCard size="lg" label="Total Open Value (Supplier)" info={<>Value of the vendor POs generated in the app whose order has <b>no status yet</b> (not received at SASH Faridabad). Value = PO quantity × the vendor&apos;s unit price. Shown per currency, as there is no exchange rate.</>} icon={<TruckIcon size={16} />} tint="amber"
                    value={supplier.by_currency.length ? formatMoney(supplier.by_currency[0]!.amount, supplier.by_currency[0]!.currency) : "—"}
                    extra={supplier.by_currency.slice(1).map((c) => formatMoney(c.amount, c.currency)).join(" + ") || undefined}
                    detail={`${ordersText(supplier.orders, supplier.without_price)} not yet received`} />
          <StatCard size="lg" label="YTD Customer Spend with SASH" info={<>Value of Deere&apos;s Firm and Order orders with a <b>ship date from 1 April</b> (start of the financial year) to today, from every upload (the latest version of each order) and manual orders. Value = Qty × Unit Price ÷ 100, in USD.</>} icon={<CalendarIcon size={16} />} tint="aqua"
                    value={formatMoney(ytd.amount, ytd.currency)}
                    detail={`${formatDate(ytd.from)} – ${formatDate(ytd.to)} · ${ordersText(ytd.orders, ytd.without_price)}`} />
        </div>

        {/* Operations (Dashboard::Overview). */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Open orders" info={<>Firm and Order orders <b>not yet delivered to Deere</b>, counted as the Orders page lists them (a combined order counts once). The amount is their value in USD.</>} icon={<FileIcon size={16} />} tint="neutral" href="/orders"
                    value={formatCount(kpis.open.count)} detail={`${usd(kpis.open.value, true)} · Firm and Order`} />
          <StatCard label="Shipping in 30 days" info={<>Open orders with a <b>ship date from today to 30 days ahead</b>, and their value. They are listed in Next shipments.</>} icon={<CalendarIcon size={16} />} tint="violet"
                    value={formatCount(kpis.due_30.count)} detail={`${usd(kpis.due_30.value, true)} due by ${formatDate(addDays(30))}`} />
          <StatCard label="Past ship date" info={<>Open orders whose <b>ship date has passed</b> and that are not yet marked delivered to Deere, and their value.</>} icon={<AlertIcon size={16} />} tint="dec" tone={kpis.overdue.count ? "bad" : undefined}
                    value={formatCount(kpis.overdue.count)} detail={`${usd(kpis.overdue.value, true)} not yet delivered`} />
          <StatCard label="PO coverage" info={<>Share of the <b>open order value that already has a vendor PO</b> (Generate PO). Below: open orders with a Qty and no PO yet.</>} icon={<CheckIcon size={16} />} tint="aqua"
                    value={`${kpis.po_coverage.percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}
                    detail={`${plural(kpis.po_coverage.without_po.count, "open order")} without a vendor PO`}>
            <Progress percent={kpis.po_coverage.percent} />
          </StatCard>
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <SaleChart points={sale.by_date} />
          <Card title="Open Value (Supplier) by vendor" info={<>Total Open Value (Supplier) split by <b>vendor</b>: one slice per vendor, with its amount and share. One pie per currency.</>} description="Vendor POs not yet received at SASH Faridabad">
            {supplier.by_currency.length === 0 ? <Empty>No open vendor POs.</Empty> : (
              <div className="space-y-6">
                {supplier.by_currency.map((c) => (
                  <PieChart key={c.currency} centerValue={formatMoney(c.amount, c.currency, true)} centerLabel={supplier.by_currency.length > 1 ? c.currency : "Total"}
                            items={supplier.by_vendor.filter((v) => v.currency === c.currency).map((v) => ({
                              label: v.vendor, value: Number(v.amount), display: formatMoney(v.amount, v.currency, true), hint: formatMoney(v.amount, v.currency),
                            }))} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Card title="Order pipeline" info={<>Open orders by their <b>latest status</b>: No status → Received (at SASH Faridabad) → Dispatched (from Faridabad) → Inbound (at SASH US). Orders delivered to Deere (Outbound) are no longer open.</>} description="Open orders by their latest status">
            <Pipeline items={overview.pipeline} />
          </Card>
          <Card title="Ageing since Firm Date" info={<>Open orders by <b>days since their Firm Date</b>: 90+ red, 60–89 yellow, 30–59 green; under 30 days or no Firm Date grey. The same colours as on the Orders page.</>} description="Open orders by days since their Firm Date">
            <Ageing items={overview.ageing} />
          </Card>
          <OutlookChart points={overview.outlook} />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Top parts by open value" info={<>The <b>8 parts with the most open value</b>, with their open orders and quantity, and their share of the total open value.</>} description="Parts with the most Firm and Order value not yet delivered">
            <TopParts items={overview.top_parts} total={Number(kpis.open.value)} />
          </Card>
          <Card title="Next shipments" info={<>The next <b>8 open orders to ship</b> within 30 days, overdue first, with their status and whether a vendor PO has been generated.</>} description="Open orders shipping in the next 30 days, overdue first"
                action={<Link href="/orders" className="shrink-0 text-sm text-ink-muted hover:text-ink">All orders →</Link>}>
            <Upcoming items={overview.upcoming} />
          </Card>
        </div>

        <SpendChart points={ytd.by_date} yearStart={ytd.from} />
      </div>
    </>
  );
}

// Open Value (Sale) by ship date: this month by week, the next 6 or 12 months; orders already past their ship date
// in an Overdue bar first.
function SaleChart({ points }: { points: DateAmount[] }) {
  const [period, setPeriod] = useState<Period>("6m");
  const bars = groupByPeriod(points.map((p) => ({ date: p.date, values: [Number(p.amount)] })), period, { ahead: true, earlier: true, series: 1 });
  return (
    <Card title="Open Value (Sale) by ship date" className="xl:col-span-2" info={<>Open order value (as in Total Open Value (Sale)) by <b>ship date</b>: this month by week, or the next 6 or 12 months by month. The red <b>Overdue</b> bar holds open orders whose ship date is before the period shown. Hover a bar for its exact amount.</>} action={<PeriodToggle value={period} onChange={setPeriod} />}
          description={`Firm and Order orders not yet delivered to Deere, ${period === "month" ? "this month by week" : `next ${period === "6m" ? "6" : "12"} months`}; overdue first`}>
      {points.length === 0 ? <Empty>No open orders.</Empty>
        : <StackedBars items={bars} series={[{ label: "Open value", color: "bg-series-a" }]} format={(v) => usd(v, true)} exact={(v) => usd(v)} />}
    </Card>
  );
}

// Demand outlook: confirmed (Firm + Order) and Forecast value by ship date, ahead.
function OutlookChart({ points }: { points: DashboardOverview["outlook"] }) {
  const [period, setPeriod] = useState<Period>("6m");
  const bars = groupByPeriod(points.map((p) => ({ date: p.date, values: [Number(p.firm), Number(p.forecast)] })), period, { ahead: true, series: 2 });
  return (
    <Card title="Demand outlook" className="lg:col-span-2 xl:col-span-1" info={<>Value of Deere&apos;s orders by <b>ship date from this month on</b>: confirmed orders (Firm + Order) and <b>Forecast</b> stacked, including orders already delivered. Shows the demand coming up.</>} action={<PeriodToggle value={period} onChange={setPeriod} />}
          description={`Confirmed orders and forecast by ship date, ${period === "month" ? "this month by week" : `next ${period === "6m" ? "6" : "12"} months`}`}>
      <StackedBars items={bars} series={[{ label: "Firm + Order", color: "bg-tint-violet-ink" }, { label: "Forecast", color: "bg-tint-violet-ink/30" }]}
                   format={(v) => usd(v, true)} exact={(v) => usd(v)} />
    </Card>
  );
}

// Customer spend with SASH by ship date: this month by week, the last 6 months, or this financial year.
function SpendChart({ points, yearStart }: { points: DateAmount[]; yearStart: string }) {
  const [period, setPeriod] = useState<Period>("year");
  const bars = groupByPeriod(points.map((p) => ({ date: p.date, values: [Number(p.amount)] })), period, { yearStart, series: 1 });
  return (
    <Card title="Customer Spend with SASH" info={<>Deere&apos;s Firm and Order order value by <b>ship date</b>: this month by week, the last 6 months, or this financial year by month (adds up to YTD Customer Spend).</>} action={<PeriodToggle value={period} onChange={setPeriod} />}
          description={`Firm and Order orders by ship date, ${period === "year" ? `financial year from ${formatDate(yearStart)}` : period === "6m" ? "last 6 months" : "this month by week"}`}>
      <StackedBars items={bars} series={[{ label: "Spend", color: "bg-series-b" }]} format={(v) => usd(v, true)} exact={(v) => usd(v)} />
    </Card>
  );
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-ink-muted">{children}</p>;
}

function Progress({ percent }: { percent: number }) {
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-tint-aqua-ink transition-[width] duration-500" style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

// Each status step with its number of open orders, their value and a bar against the largest step.
function Pipeline({ items }: { items: DashboardOverview["pipeline"] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ol className="space-y-4">
      {items.map((item, i) => (
        <li key={item.status}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xs font-semibold text-ink-muted">{i + 1}</span>
              <span className="truncate font-medium text-ink" title={STATUS[item.status].hint}>{STATUS[item.status].label}</span>
            </span>
            <span className="tabular shrink-0 text-ink">{formatCount(item.count)}<span className="ml-1.5 text-xs text-ink-muted">{usd(item.value, true)}</span></span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div className={`h-full rounded-full transition-[width] duration-500 ${STATUS[item.status].color}`}
                 style={{ width: `${Math.max((item.count / max) * 100, item.count ? 2 : 0)}%` }} />
          </div>
          <p className="mt-1 text-xs text-ink-faint">{STATUS[item.status].hint}</p>
        </li>
      ))}
    </ol>
  );
}

// One stacked bar of the age groups (share of open orders), then each group with its orders and value.
function Ageing({ items }: { items: DashboardOverview["ageing"] }) {
  const total = items.reduce((a, i) => a + i.count, 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-neutral-100">
        {total > 0 && items.map((item) => item.count ? (
          <div key={item.band} className={AGE[item.band].color} style={{ width: `${(item.count / total) * 100}%` }}
               title={`${AGE[item.band].label}: ${plural(item.count, "order")}`} />
        ) : null)}
      </div>
      <ul className="mt-5 divide-y divide-neutral-100">
        {items.map((item) => (
          <li key={item.band} className="flex items-center gap-3 py-2.5 text-sm">
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-sm ${AGE[item.band].color}`} />
            <span className="min-w-0 flex-1 truncate text-ink">{AGE[item.band].label}</span>
            <span className="tabular text-ink">{formatCount(item.count)}</span>
            <span className="tabular w-16 text-right text-xs text-ink-muted">{usd(item.value, true)}</span>
            <span className="tabular w-10 text-right text-xs text-ink-muted">{total ? Math.round((item.count / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopParts({ items, total }: { items: DashboardOverview["top_parts"]; total: number }) {
  if (items.length === 0) return <Empty>No open orders.</Empty>;
  const max = Math.max(1, ...items.map((p) => Number(p.value)));
  return (
    <ul className="-mx-6 divide-y divide-neutral-100 border-t border-line">
      {items.map((p, i) => (
        <li key={p.part_number} className="flex items-center gap-4 px-6 py-3">
          <span className="tabular w-5 shrink-0 text-xs font-semibold text-ink-faint">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{p.part_number}</span>
            <span className="block truncate text-xs text-ink-muted" title={p.description ?? undefined}>
              {p.description ?? "—"} · {plural(p.orders, "order")} · {formatQty(p.qty)} pcs
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <span className="block h-full rounded-full bg-tint-violet-ink" style={{ width: `${(Number(p.value) / max) * 100}%` }} />
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="tabular block font-semibold text-ink">{usd(p.value, true)}</span>
            <span className="tabular block text-xs text-ink-muted">{total ? Math.round((Number(p.value) / total) * 100) : 0}% of open</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Upcoming({ items }: { items: DashboardOverview["upcoming"] }) {
  if (items.length === 0) return <Empty>Nothing ships in the next 30 days.</Empty>;
  return (
    <ul className="-mx-6 divide-y divide-neutral-100 border-t border-line">
      {items.map((o) => {
        const [day, month, year] = formatDate(o.ship_date).split(" ");
        return (
          <li key={`${o.manual ? "m" : "r"}${o.id}`} className="flex items-center gap-4 px-6 py-3">
            <span className={`tabular w-16 shrink-0 text-sm font-semibold leading-tight ${o.overdue ? "text-age-red-ink" : "text-ink"}`}>
              {day} {month}
              <span className="block text-2xs font-medium uppercase tracking-wider">{o.overdue ? "Overdue" : year}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{o.part_number} <span className="font-normal text-ink-muted">· PO {o.po_number}/{o.po_line_number}</span></span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-ink-muted">{STATUS[o.status].label}</span>
                {o.po
                  ? <span className="rounded bg-age-green px-1.5 py-0.5 font-medium text-age-green-ink">PO generated</span>
                  : <span className="rounded bg-age-yellow px-1.5 py-0.5 font-medium text-age-yellow-ink">No vendor PO</span>}
                <span className="text-ink-faint">{o.order_type}</span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="tabular block font-semibold text-ink">{usd(o.value, true)}</span>
              <span className="tabular block text-xs text-ink-muted">{formatQty(o.qty)} pcs</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-lg border border-line bg-white px-6 py-5 shadow-card">
            <Skeleton className="h-3 w-32" /><Skeleton className="mt-3 h-8 w-40" /><Skeleton className="mt-2 h-3.5 w-48" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-lg xl:col-span-2" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    </div>
  );
}
