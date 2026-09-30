import type { ReactNode } from "react";
import type { UploadDetail } from "@/lib/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { AlertIcon, ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, CheckIcon, FileIcon, HistoryIcon } from "./icons";
import { Badge } from "./ui/badge";
import { TINTS, type Tint } from "./ui/tint";

// ─── Shared KPI building block ───────────────────────────────────────────────

function Kpi({ label, value, tone, hint, icon, tint = "neutral" }: {
  label: string; value: ReactNode; tone?: "up" | "down"; hint?: string; icon: ReactNode; tint?: Tint;
}) {
  const color = tone === "up" ? "text-inc" : tone === "down" ? "text-dec" : "text-ink";
  const t = TINTS[tint];
  return (
    <div className={`bg-white bg-gradient-to-b ${t.wash} via-white to-white rounded-xl border border-neutral-200 px-4 py-4`}>
      <div className="flex items-start justify-between gap-2">
        <dt className="truncate text-xs font-medium text-ink-muted leading-tight">{label}</dt>
        <span aria-hidden className={`-mr-0.5 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${t.chip} text-neutral-400`}>{icon}</span>
      </div>
      <dd className={`tabular mt-2 flex items-baseline gap-1 text-xl font-semibold tracking-tight ${color}`}>
        {tone && value !== 0 && value !== "0" && (
          <svg aria-hidden width="9" height="9" viewBox="0 0 10 10" className={`self-center ${tone === "down" ? "rotate-180" : ""}`}>
            <path d="M5 1.5 9 7.5H1z" fill="currentColor" />
          </svg>
        )}
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

// ─── Strip KPI cell (for the horizontal full-width tracking bar) ──────────────

function StripKpi({ label, value, tone, hint }: {
  label: string; value: ReactNode; tone?: "up" | "down"; hint?: string;
}) {
  const color = tone === "up" ? "text-inc" : tone === "down" ? "text-dec" : "text-neutral-900";
  return (
    <div className="flex flex-col justify-center px-4 py-3 min-w-0">
      <dt className="text-[11px] font-medium text-ink-muted uppercase tracking-wide truncate mb-0.5">{label}</dt>
      <dd className={`tabular text-xl font-bold ${color} leading-none`}>
        {tone && value !== 0 && value !== "0" && (
          <svg aria-hidden width="9" height="9" viewBox="0 0 10 10" className={`inline mr-0.5 self-center ${tone === "down" ? "rotate-180" : ""}`}>
            <path d="M5 1.5 9 7.5H1z" fill="currentColor" />
          </svg>
        )}
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint truncate">{hint}</p>}
    </div>
  );
}

// ─── Full-width horizontal KPI tracking strip ─────────────────────────────────

export function VersionKpisStrip({ upload }: { upload: UploadDetail }) {
  const s = upload.stats;
  const baseline = upload.previous_version === null;

  const cells = baseline
    ? [
        <StripKpi key="rows" label="Order rows stored" value={formatCount(s.row_count)} hint={`from ${formatCount(s.source_row_count)} Excel rows`} />,
        <StripKpi key="dup" label="Duplicates merged" value={formatCount(s.duplicate_rows_merged)} />,
        <StripKpi key="unknown" label="Unknown quantity" value={formatCount(s.unknown_quantity_count)} hint="not compared" />,
        <StripKpi key="known" label="Comparable rows" value={formatCount((s.row_count ?? 0) - (s.unknown_quantity_count ?? 0))} />,
      ]
    : [
        <StripKpi key="rows" label="Rows processed" value={formatCount(s.row_count)} hint={`from ${formatCount(s.source_row_count)} Excel rows`} />,
        <StripKpi key="compared" label="Rows compared" value={formatCount(s.compared_count)} hint="with the previous upload" />,
        <StripKpi key="up" label="↑ Quantity up" value={formatCount(s.increase_count)} tone={s.increase_count ? "up" : undefined} />,
        <StripKpi key="down" label="↓ Quantity down" value={formatCount(s.decrease_count)} tone={s.decrease_count ? "down" : undefined} />,
        <StripKpi key="same" label="No change" value={formatCount(s.unchanged_count)} />,
      ];

  return (
    <dl className={`grid grid-cols-2 md:grid-cols-${baseline ? 4 : 5} divide-x divide-neutral-100 bg-white border border-neutral-200 rounded-xl shadow-sm mb-6`}>
      {cells}
    </dl>
  );
}

// ─── Split individual KPI cards grid ─────────────────────────────────────────

export function VersionKpis({ upload }: { upload: UploadDetail }) {
  const s = upload.stats;
  const baseline = upload.previous_version === null;

  const kpis = baseline
    ? [
        <Kpi key="rows" label="Order rows stored" value={formatCount(s.row_count)} hint={`from ${formatCount(s.source_row_count)} Excel rows`} icon={<FileIcon size={16} />} tint="neutral" />,
        <Kpi key="dup" label="Duplicates merged" value={formatCount(s.duplicate_rows_merged)} icon={<HistoryIcon size={16} />} tint="violet" />,
        <Kpi key="unknown" label="Unknown quantity" value={formatCount(s.unknown_quantity_count)} hint="not compared" icon={<AlertIcon size={16} />} tint="amber" />,
        <Kpi key="known" label="Comparable rows" value={formatCount((s.row_count ?? 0) - (s.unknown_quantity_count ?? 0))} icon={<CheckIcon size={16} />} tint="aqua" />,
      ]
    : [
        <Kpi key="rows" label="Rows processed" value={formatCount(s.row_count)} hint={`from ${formatCount(s.source_row_count)} Excel rows`} icon={<FileIcon size={16} />} tint="neutral" />,
        <Kpi key="compared" label="Rows compared" value={formatCount(s.compared_count)} hint="with the previous upload" icon={<ArrowUpDownIcon size={16} />} tint="violet" />,
        <Kpi key="up" label="↑ Quantity up" value={formatCount(s.increase_count)} tone={s.increase_count ? "up" : undefined} icon={<ArrowUpIcon size={16} />} tint="inc" />,
        <Kpi key="down" label="↓ Quantity down" value={formatCount(s.decrease_count)} tone={s.decrease_count ? "down" : undefined} icon={<ArrowDownIcon size={16} />} tint="dec" />,
        <Kpi key="same" label="No change" value={formatCount(s.unchanged_count)} icon={<CheckIcon size={16} />} tint="aqua" />,
      ];

  return (
    <dl className={`grid gap-3 ${baseline ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}>
      {kpis}
    </dl>
  );
}

// ─── Left sidebar context card ────────────────────────────────────────────────

export function VersionMeta({ upload, status }: { upload: UploadDetail; status?: ReactNode }) {
  const s = upload.stats;
  const baseline = upload.previous_version === null;

  const meta: [string, number | null][] = baseline
    ? []
    : [["Duplicates merged", s.duplicate_rows_merged], ["New rows (ignored)", s.new_row_count], ["No longer present (ignored)", s.missing_row_count]];

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 text-xs space-y-2">
      {/* Version identity */}
      <div className="flex items-center gap-2 pb-1">
        <span className="rounded-md bg-neutral-900 px-2 py-0.5 text-xs font-semibold text-white">Latest upload</span>
        {baseline ? <Badge>First upload</Badge> : <span className="text-ink-muted">vs previous upload</span>}
      </div>

      {/* Metadata rows */}
      <div className="space-y-1.5 text-ink-muted leading-relaxed">
        <p className="truncate">{upload.original_filename}</p>
        <p>{upload.uploaded_by}</p>
        <p>{formatDateTime(upload.completed_at)}</p>
      </div>

      {/* Email / notification status */}
      {status && (
        <div className="pt-1 border-t border-neutral-200">
          {status}
        </div>
      )}

      {/* Secondary stats */}
      {meta.length > 0 && (
        <div className="pt-1 border-t border-neutral-200 space-y-1.5 text-ink-muted">
          {meta.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <span className="tabular font-semibold text-ink">{formatCount(value)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Baseline note */}
      {baseline && (
        <p className="pt-1 border-t border-neutral-200 text-ink-muted leading-relaxed">
          First upload — changes are detected from the next upload onward. No email sent.
        </p>
      )}

      {/* Warnings */}
      {upload.warnings.length > 0 && (
        <div className="pt-1 space-y-1.5">
          {upload.warnings.map((w) => (
            <div key={w.code} className="bg-neutral-900 text-neutral-100 text-[11px] leading-relaxed p-3 rounded-lg border border-neutral-800 shadow-sm">
              <span className="inline-flex items-start gap-1.5">
                <AlertIcon size={12} className="mt-0.5 shrink-0 text-neutral-400" />
                {w.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Legacy single-card summary (Upload History detail page) ──────────────────

export function VersionSummary({ upload, status }: { upload: UploadDetail; status?: ReactNode }) {
  const s = upload.stats;
  const baseline = upload.previous_version === null;

  const kpis = baseline
    ? [
        <Kpi key="rows" label="Order rows stored" value={formatCount(s.row_count)} hint={`from ${formatCount(s.source_row_count)} Excel rows`} icon={<FileIcon size={16} />} tint="neutral" />,
        <Kpi key="dup" label="Duplicates merged" value={formatCount(s.duplicate_rows_merged)} icon={<HistoryIcon size={16} />} tint="violet" />,
        <Kpi key="unknown" label="Unknown quantity" value={formatCount(s.unknown_quantity_count)} hint="not compared" icon={<AlertIcon size={16} />} tint="amber" />,
        <Kpi key="known" label="Comparable rows" value={formatCount((s.row_count ?? 0) - (s.unknown_quantity_count ?? 0))} icon={<CheckIcon size={16} />} tint="aqua" />,
      ]
    : [
        <Kpi key="rows" label="Rows processed" value={formatCount(s.row_count)} hint={`from ${formatCount(s.source_row_count)} Excel rows`} icon={<FileIcon size={16} />} tint="neutral" />,
        <Kpi key="compared" label="Rows compared" value={formatCount(s.compared_count)} hint="with the previous upload" icon={<ArrowUpDownIcon size={16} />} tint="violet" />,
        <Kpi key="up" label="↑ Quantity up" value={formatCount(s.increase_count)} tone={s.increase_count ? "up" : undefined} icon={<ArrowUpIcon size={16} />} tint="inc" />,
        <Kpi key="down" label="↓ Quantity down" value={formatCount(s.decrease_count)} tone={s.decrease_count ? "down" : undefined} icon={<ArrowDownIcon size={16} />} tint="dec" />,
        <Kpi key="same" label="No change" value={formatCount(s.unchanged_count)} icon={<CheckIcon size={16} />} tint="aqua" />,
      ];

  const meta: [string, number | null][] = baseline
    ? []
    : [["Duplicates merged", s.duplicate_rows_merged], ["New rows (ignored)", s.new_row_count], ["No longer present (ignored)", s.missing_row_count]];

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-neutral-50 px-6 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="rounded-md bg-neutral-900 px-2.5 py-0.5 text-base font-semibold text-white">Upload</h2>
          {baseline ? <Badge>First upload</Badge> : <span className="text-sm text-ink-muted">compared with the previous upload</span>}
          <span className="truncate text-sm text-ink-muted">· {upload.original_filename} · {upload.uploaded_by} · {formatDateTime(upload.completed_at)}</span>
        </div>
        {status}
      </header>

      <dl className={`grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-3 ${baseline ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
        {kpis}
      </dl>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-white px-6 py-4 text-sm">
        {baseline && <span className="text-ink-muted">First upload: quantity changes are detected from the next upload onward. No email is sent.</span>}
        {meta.map(([label, value]) => (
          <span key={label} className="text-ink-muted">
            {label} <span className="tabular font-medium text-ink">{formatCount(value)}</span>
          </span>
        ))}
        {upload.warnings.map((w) => (
          <span key={w.code} className="inline-flex items-center gap-1.5 font-medium text-neutral-900">
            <AlertIcon size={14} />
            {w.message}
          </span>
        ))}
      </footer>
    </section>
  );
}
