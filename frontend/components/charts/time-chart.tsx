"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type XAxisTickContentProps } from "recharts";
import type { Bar } from "./month-bars";

type Series = { label: string; color: string };
type Point = { key: string; label: string; sublabel?: string; title: string } & Record<string, string | number | undefined>;

// Area chart of values per period (`groupByPeriod` bars): a smooth line with a soft gradient per series (stacked when
// there are several), dashed horizontal gridlines, the amounts on the left axis (`format`), each period's label and
// year underneath, and a hover card with the exact amounts (`exact`). Fills its container's width.
export function TimeChart({ items, series, format, exact }: {
  items: Bar[]; series: Series[]; format: (value: number) => string; exact?: (value: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const data: Point[] = items.map((i) => ({
    key: i.key, label: i.label, sublabel: i.sublabel, title: i.title,
    ...Object.fromEntries(series.map((_, j) => [`s${j}`, i.values[j] ?? 0])),
  }));
  const stacked = series.length > 1;

  return (
    <div>
      {stacked && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}
            </span>
          ))}
        </div>
      )}
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              {series.map((s, j) => (
                <linearGradient key={s.label} id={`${id}-${j}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={stacked && j > 0 ? 0.25 : 0.32} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="#e9ecf0" strokeDasharray="4 4" />
            <XAxis dataKey="key" axisLine={false} tickLine={false} height={38} minTickGap={8}
                   interval={data.length <= 7 ? 0 : "preserveStartEnd"}
                   tick={({ x, y, payload }: XAxisTickContentProps) => {
                     const point = data[payload.index ?? 0];
                     return (
                       <g transform={`translate(${x},${y})`}>
                         <text dy={12} textAnchor="middle" fontSize={11} fill="#5b6270">{point?.label}</text>
                         {point?.sublabel && <text dy={25} textAnchor="middle" fontSize={10} fill="#9aa1ac">{point.sublabel}</text>}
                       </g>
                     );
                   }} />
            <YAxis axisLine={false} tickLine={false} width={58} tickCount={5} tick={{ fontSize: 11, fill: "#9aa1ac" }}
                   tickFormatter={(v: number) => (v ? format(v) : "0")} />
            <Tooltip cursor={{ stroke: "#c3c9d2", strokeDasharray: "4 4" }}
                     content={({ active, payload }) => {
                       if (!active || !payload?.length) return null;
                       const point = payload[0]!.payload as Point;
                       const values = series.map((s, j) => ({ ...s, value: Number(point[`s${j}`] ?? 0) }));
                       const full = exact ?? format;
                       return (
                         <div className="min-w-44 rounded-lg border border-line bg-white px-3 py-2.5 text-xs shadow-lg">
                           <p className="mb-1.5 font-semibold text-ink">{point.title}</p>
                           {values.map((v) => (
                             <p key={v.label} className="flex items-center justify-between gap-4 py-0.5">
                               <span className="inline-flex items-center gap-1.5 text-ink-muted">
                                 <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: v.color }} />{v.label}
                               </span>
                               <span className="tabular font-semibold text-ink">{full(v.value)}</span>
                             </p>
                           ))}
                           {stacked && (
                             <p className="mt-1 flex justify-between gap-4 border-t border-neutral-100 pt-1.5">
                               <span className="text-ink-muted">Total</span>
                               <span className="tabular font-semibold text-ink">{full(values.reduce((a, v) => a + v.value, 0))}</span>
                             </p>
                           )}
                         </div>
                       );
                     }} />
            {series.map((s, j) => (
              <Area key={s.label} type="monotone" dataKey={`s${j}`} name={s.label} stackId={stacked ? "total" : undefined}
                    stroke={s.color} strokeWidth={2.25} fill={`url(#${id}-${j})`} isAnimationActive
                    dot={data.length <= 12 ? { r: 3, fill: "#fff", stroke: s.color, strokeWidth: 2 } : false}
                    activeDot={{ r: 5, fill: s.color, stroke: "#fff", strokeWidth: 2 }} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
