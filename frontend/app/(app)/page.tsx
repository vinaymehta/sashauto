"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Stats } from "@/lib/types";
import { formatCount, formatDate, formatDateTime, formatQty, formatRelative, formatUploadParts } from "@/lib/format";
import { BarList } from "@/components/charts/bar-list";
import { ChangesTrend } from "@/components/charts/changes-trend";
import { ChangeValue } from "@/components/direction";
import { AlertIcon, ArrowUpDownIcon, BoxIcon, CheckIcon, FileIcon, HistoryIcon, UploadIcon } from "@/components/icons";
import { UploadStatusBadge } from "@/components/upload-status";
import { useApi } from "@/components/use-api";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { TINTS, type Tint } from "@/components/ui/tint";

const SOURCE_LABELS: Record<string, string> = { qty: "Qty", previous_qty: "Previous Qty (Qty blank)", unknown: "Unknown (both blank)" };
const TYPE_ORDER = ["Order", "Firm", "Forecast"];
const TYPE_COLORS: Record<string, string> = { Order: "bg-type-order", Firm: "bg-type-firm", Forecast: "bg-type-forecast" };
// Status colours always travel with an icon and a label.
const SOURCE_STYLE: Record<string, { color: string; icon: ReactNode }> = {
  qty: { color: "bg-quality-good", icon: <CheckIcon size={13} className="text-quality-good" /> },
  previous_qty: { color: "bg-quality-warning", icon: <HistoryIcon size={13} className="text-tint-amber-ink" /> },
  unknown: { color: "bg-quality-serious", icon: <AlertIcon size={13} className="text-quality-serious" /> },
};
const SERIES_COLORS = ["bg-series-a", "bg-series-b"];


function Card({ title, description, action, children, className = "" }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card ${className}`}>
      <header className="flex items-start justify-between gap-3 px-6 pb-4 pt-6">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        {action}
      </header>
      <div className="flex-1 px-6 pb-6">{children}</div>
    </section>
  );
}

function Tile({ label, value, detail, href, icon, tint = "neutral" }: {
  label: string; value: ReactNode; detail?: ReactNode; href?: string; icon: ReactNode; tint?: Tint;
}) {
  const t = TINTS[tint];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="mb-1.5 truncate text-xs font-medium text-neutral-400">{label}</p>
        <span aria-hidden className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center text-neutral-400">{icon}</span>
      </div>
      <p className="tabular -mt-1 text-2xl font-bold tracking-tight text-neutral-900">{value}</p>
      {detail && <p className="mt-1 truncate text-sm text-ink-muted">{detail}</p>}
    </>
  );
  // A soft tint washes in from the top of the tile and fades to white.
  const className = `block rounded-lg border border-line bg-gradient-to-b ${t.wash} via-white to-white px-6 py-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)]`;
  return href
    ? <Link href={href} className={`${className} hover:border-neutral-300`}>{body}</Link>
    : <div className={className}>{body}</div>;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data, error, loading } = useApi<Stats>("/api/stats");

  const header = (
    <PageHeader
      title="Dashboard"
      description="Uploads, quantity changes and data quality at a glance."
      actions={<Link href="/detect"><Button variant="primary"><UploadIcon size={15} />Upload new file</Button></Link>}
    />
  );

  if (error) return <>{header}<Alert title="Could not load the dashboard">{error.message}</Alert></>;
  if (loading && !data) return <>{header}<DashboardSkeleton /></>;
  if (!data) return null;

  const { latest, totals, last_30_days: month, trend, composition, top_changes: topChanges, recent_uploads: recent } = data;
  const top = topChanges.changes;
  const compared = trend.filter((p) => !p.baseline);
  const busiest = compared.reduce<(typeof trend)[number] | null>((best, p) =>
    p.increases + p.decreases > (best ? best.increases + best.decreases : 0) ? p : best, null);

  if (!latest) {
    return (
      <>
        {header}
        <section className="rounded-lg border border-line bg-surface shadow-card">
          <EmptyState title="No uploads yet" description="Upload the first Supplier Requirements export. Quantity changes are detected from the second upload onward."
                      action={<Link href="/detect"><Button variant="primary">Go to Upload / Detection</Button></Link>} />
        </section>
      </>
    );
  }

  const attention = [
    totals.open_conflicts > 0 && { text: `${totals.open_conflicts} Commodity Type conflict${totals.open_conflicts === 1 ? "" : "s"} to review`, href: "/products?conflicts=open" },
    totals.emails_failed > 0 && { text: `${totals.emails_failed} email${totals.emails_failed === 1 ? "" : "s"} failed to send`, href: "/detect" },
    totals.in_progress > 0 && { text: `${totals.in_progress} upload${totals.in_progress === 1 ? " is" : "s are"} processing`, href: "/detect" },
  ].filter(Boolean) as { text: string; href: string }[];

  const latestChanges = (latest.increase_count ?? 0) + (latest.decrease_count ?? 0);
  const typeItems = composition
    ? TYPE_ORDER.filter((t) => composition.by_type[t]).map((t) => ({ label: t, value: composition.by_type[t]!, color: TYPE_COLORS[t] }))
    : [];
  const sourceItems = composition
    ? ["qty", "previous_qty", "unknown"].filter((k) => composition.by_quantity_source[k]).map((k) => ({ label: SOURCE_LABELS[k]!, value: composition.by_quantity_source[k]!, ...SOURCE_STYLE[k]! }))
    : [];
  const shipToItems = composition
    // Colour follows the location (sorted by name), not its rank, so it stays stable between uploads.
    ? Object.entries(composition.by_ship_to).sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, value], i) => ({ label, value, color: SERIES_COLORS[i] ?? "bg-neutral-400" }))
    : [];

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

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile label="Latest upload" value={formatUploadParts(latest.completed_at!)[0]} href="/orders" icon={<FileIcon size={16} />} tint="neutral"
                detail={`${formatUploadParts(latest.completed_at!)[1]} · ${formatRelative(latest.completed_at)}`} />
          <Tile label="Latest changes" value={formatCount(latestChanges)} href="/detect" icon={<ArrowUpDownIcon size={16} />} tint="direction"
                detail={latest.previous_version ? `↑ ${formatCount(latest.increase_count)} · ↓ ${formatCount(latest.decrease_count)}` : "First upload, not compared"} />
          <Tile label="Changes · 30 days" value={formatCount(month.increases + month.decreases)} icon={<HistoryIcon size={16} />} tint="violet"
                detail={`↑ ${formatCount(month.increases)} · ↓ ${formatCount(month.decreases)}`} />
          <Tile label="Products" value={formatCount(totals.products)} href="/products" icon={<BoxIcon size={16} />} tint="amber"
                detail={totals.open_conflicts ? `${totals.open_conflicts} open conflict${totals.open_conflicts === 1 ? "" : "s"}` : `${formatCount(totals.emails_sent)} alert email${totals.emails_sent === 1 ? "" : "s"} sent`} />
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <Card title="Quantity changes per upload" description={`Last ${trend.length} upload${trend.length === 1 ? "" : "s"}, each compared with the upload before it`} className="xl:col-span-2">
            <ChangesTrend points={trend} />
            <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
              {[
                ["Uploads compared", formatCount(compared.length)],
                ["Total ↑ quantity up", formatCount(compared.reduce((a, p) => a + p.increases, 0))],
                ["Total ↓ quantity down", formatCount(compared.reduce((a, p) => a + p.decreases, 0))],
                ["Most changes", busiest ? `${formatUploadParts(busiest.completed_at).join(", ")} · ${formatCount(busiest.increases + busiest.decreases)}` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="bg-neutral-50 px-5 py-4">
                  <dt className="text-xs text-ink-muted">{label}</dt>
                  <dd className="tabular mt-0.5 font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Current order data"
                description={composition?.ship_dates.first ? `${formatCount(latest.row_count)} order rows · ship dates ${formatDate(composition.ship_dates.first)} – ${formatDate(composition.ship_dates.last)}` : undefined}>
            <div className="space-y-5">
              <div><p className="mb-2 text-xs font-medium text-ink-muted">By type</p><BarList items={typeItems} /></div>
              <div><p className="mb-2 text-xs font-medium text-ink-muted">Quantity taken from</p><BarList items={sourceItems} /></div>
              {shipToItems.length > 1 && <div><p className="mb-2 text-xs font-medium text-ink-muted">Ship To Location</p><BarList items={shipToItems} /></div>}
            </div>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Largest changes"
                description={topChanges.upload_id
                  ? topChanges.upload_id === latest.id
                    ? "In the latest upload, by size of the change"
                    : `From the upload of ${formatDateTime(topChanges.completed_at)}; the latest upload had none`
                  : "By size of the change"}
                action={topChanges.upload_id ? <Link href={topChanges.upload_id === latest.id ? "/detect" : `/uploads/${topChanges.upload_id}`} className="shrink-0 text-sm text-ink-muted hover:text-ink">View all →</Link> : undefined}>
            {top.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-muted">No quantity changes have been detected yet.</p>
            ) : (
              <ul className="-mx-6 divide-y divide-neutral-100 border-t border-line">
                {top.map((c) => (
                  <li key={c.id} className="flex items-center gap-4 px-6 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{c.part_number} <span className="font-normal text-ink-muted">· PO {c.po_number}/{c.po_line_number}</span></p>
                      <p className="text-sm text-ink-muted">{c.order_type} · ship {formatDate(c.ship_date)}</p>
                    </div>
                    <p className="tabular text-right text-sm text-ink-muted">{formatQty(c.old_qty)} → <span className="text-ink">{formatQty(c.new_qty)}</span></p>
                    <div className="w-24 text-right"><ChangeValue direction={c.direction} difference={c.difference} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent uploads">
            <ul className="-mx-6 divide-y divide-neutral-100 border-t border-line">
              {recent.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => router.push(`/uploads/${u.id}`)}
                          className="flex w-full items-center gap-4 px-6 py-3.5 text-left transition-colors hover:bg-neutral-50">
                    <span className="tabular w-16 shrink-0 leading-tight">
                      <span className="block text-sm font-semibold text-ink">{formatUploadParts(u.uploaded_at)[0]}</span>
                      <span className="block text-xs text-ink-muted">{formatUploadParts(u.uploaded_at)[1]}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{u.original_filename}</span>
                      <span className="block text-sm text-ink-muted">{u.uploaded_by} · {formatRelative(u.uploaded_at)}</span>
                    </span>
                    <span className="tabular text-sm text-ink-muted">
                      {u.status === "completed" ? (u.change_count === null ? "First upload" : `${formatCount(u.change_count)} change${u.change_count === 1 ? "" : "s"}`) : ""}
                    </span>
                    <UploadStatusBadge status={u.status} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-line bg-white px-6 py-5 shadow-card">
            <Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-16" /><Skeleton className="mt-2 h-3.5 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-lg xl:col-span-2" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    </div>
  );
}
