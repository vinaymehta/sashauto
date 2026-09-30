"use client";

import { useState } from "react";
import type { TrendPoint } from "@/lib/types";
import { formatCount, formatDateTime, formatUploadParts } from "@/lib/format";
import { useElementWidth } from "../use-element-width";

const HEIGHT = 300;
const M = { top: 12, right: 8, bottom: 40, left: 40 };
const GAP = 1; // half of the 2px surface gap between the increase and decrease bars at the zero line

// Rounds the axis maximum up to a readable number (1, 2, 5 × 10^n).
function niceMax(value: number) {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= value)!;
  return step * pow;
}

// Bar with a 4px rounded data end and a square end on the baseline.
function bar(x: number, y0: number, w: number, h: number, up: boolean) {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  if (up) {
    const top = y0 - h;
    return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`;
  }
  const bottom = y0 + h;
  return `M${x},${y0}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + w - r}Q${x + w},${bottom} ${x + w},${bottom - r}V${y0}Z`;
}

// Diverging column chart: quantity up above the zero line, quantity down below, one column per upload.
export function ChangesTrend({ points }: { points: TrendPoint[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.increases, p.decreases))));
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const zero = M.top + plotH / 2;
  const scale = (v: number) => (v / max) * (plotH / 2 - GAP);
  const band = points.length ? plotW / points.length : 0;
  const barW = Math.min(24, Math.max(6, band * 0.45));
  const ticks = [max, max / 2, 0, -max / 2, -max];
  const active = hover !== null ? points[hover] : null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-inc-mark" />↑ Quantity up</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-dec-mark" />↓ Quantity down</span>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img"
               aria-label={`Quantity changes for the last ${points.length} uploads`}>
            {ticks.map((t) => {
              const y = zero - scale(Math.abs(t)) * Math.sign(t) - (t > 0 ? GAP : t < 0 ? -GAP : 0);
              return (
                <g key={t}>
                  <line x1={M.left} x2={width - M.right} y1={y} y2={y}
                        className={t === 0 ? "stroke-line-strong" : "stroke-line"} strokeDasharray={t === 0 ? undefined : "2 4"} />
                  <text x={M.left - 8} y={y} dy="0.32em" textAnchor="end" className="fill-ink-faint text-2xs tabular">
                    {t === 0 ? "0" : `${t > 0 ? "+" : "−"}${formatCount(Math.abs(t))}`}
                  </text>
                </g>
              );
            })}

            {points.map((p, i) => {
              const cx = M.left + band * i + band / 2;
              const x = cx - barW / 2;
              return (
                <g key={p.completed_at}>
                  {hover === i && <rect x={M.left + band * i + 2} y={M.top} width={band - 4} height={plotH} rx={4} className="fill-subtle" />}
                  <path d={bar(x, zero - GAP, barW, scale(p.increases), true)} className="fill-inc-mark" />
                  <path d={bar(x, zero + GAP, barW, scale(p.decreases), false)} className="fill-dec-mark" />
                  {p.baseline && <circle cx={cx} cy={zero} r={3} className="fill-ink-faint" />}
                  <text x={cx} y={HEIGHT - 22} textAnchor="middle"
                        className={`text-2xs tabular ${hover === i ? "fill-ink font-medium" : "fill-ink-muted"}`}>
                    <tspan x={cx}>{formatUploadParts(p.completed_at)[0]}</tspan>
                    <tspan x={cx} dy="13" className="fill-ink-faint">{formatUploadParts(p.completed_at)[1]}</tspan>
                  </text>
                  {/* Hit target covers the whole column, larger than the marks. */}
                  <rect x={M.left + band * i} y={M.top} width={band} height={plotH + M.bottom} fill="transparent"
                        onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
        )}

        {active && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-52 animate-pop-in rounded-lg border border-line bg-surface px-3 py-2.5 text-xs shadow-pop"
            style={{ left: Math.min(Math.max(M.left + band * hover + band / 2 - 104, 0), Math.max(0, width - 208)) }}
          >
            <p className="font-semibold text-ink">{formatDateTime(active.completed_at)}</p>
            {active.baseline ? (
              <p className="mt-1.5 text-ink-muted">First upload, not compared</p>
            ) : (
              <dl className="mt-1.5 space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="inline-flex items-center gap-1.5 text-ink-muted"><span className="h-2 w-2 rounded-sm bg-inc-mark" />↑ Up</dt>
                  <dd className="tabular font-medium text-ink">{formatCount(active.increases)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="inline-flex items-center gap-1.5 text-ink-muted"><span className="h-2 w-2 rounded-sm bg-dec-mark" />↓ Down</dt>
                  <dd className="tabular font-medium text-ink">{formatCount(active.decreases)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-line pt-1">
                  <dt className="text-ink-muted">Rows compared</dt>
                  <dd className="tabular text-ink">{formatCount(active.compared)}</dd>
                </div>
              </dl>
            )}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Quantity changes per upload</caption>
        <thead><tr><th>Upload</th><th>Quantity up</th><th>Quantity down</th><th>Rows compared</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.completed_at}><td>{formatDateTime(p.completed_at)}</td><td>{p.baseline ? "first upload" : p.increases}</td><td>{p.baseline ? "first upload" : p.decreases}</td><td>{p.compared ?? "—"}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
