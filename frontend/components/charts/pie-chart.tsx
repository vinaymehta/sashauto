"use client";

import { useState, type ReactNode } from "react";

// Donut chart with a legend: each slice's label, value (`display`) and share. The centre shows `centerLabel` /
// `centerValue` (e.g. the total). Colours repeat after eight slices. The legend lists the first `visible` slices
// (largest first as given) with a "Show more" button for the rest.
const VISIBLE = 5;
const COLORS = ["#7c3aed", "#d97706", "#0891b2", "#16a34a", "#db2777", "#4f46e5", "#65a30d", "#dc2626"];

export function PieChart({ items, centerLabel, centerValue, visible = VISIBLE }: {
  // node: what the legend shows for the label (e.g. a link that opens the vendor); the label otherwise.
  items: { label: string; value: number; display: string; hint?: string; node?: ReactNode }[];
  centerLabel?: string;
  centerValue?: string;
  visible?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, visible);
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const radius = 15.9155; // circumference 100, so dash lengths are percentages
  let offset = 25; // start at 12 o'clock

  return (
    // The legend goes beside the donut only when the card itself is wide enough (container query), else under it.
    <div className="@container">
      <div className="flex flex-col items-center gap-5 @md:flex-row @md:items-center">
        <div className="relative h-44 w-44 shrink-0">
          <svg viewBox="0 0 42 42" className="h-full w-full" role="img" aria-label="Share by vendor">
            <circle cx="21" cy="21" r={radius} fill="none" stroke="#f1f1f1" strokeWidth="6" />
            {total > 0 && items.map((item, i) => {
              const share = (item.value / total) * 100;
              const dash = `${share} ${100 - share}`;
              const circle = (
                <circle key={item.label} cx="21" cy="21" r={radius} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="6"
                        strokeDasharray={dash} strokeDashoffset={offset}>
                  <title>{`${item.label}: ${item.hint ?? item.display} (${Math.round(share)}%)`}</title>
                </circle>
              );
              offset -= share;
              return circle;
            })}
          </svg>
          {(centerLabel || centerValue) && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              {centerValue && <span className="tabular text-base font-bold text-ink">{centerValue}</span>}
              {centerLabel && <span className="text-2xs text-ink-muted">{centerLabel}</span>}
            </div>
          )}
        </div>
        <div className="w-full min-w-0">
        <ul className="space-y-2">
          {shown.map((item, i) => (
            <li key={item.label} className="flex items-center gap-2 text-sm" title={item.hint}>
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate text-ink">{item.node ?? item.label}</span>
              <span className="tabular shrink-0 text-ink">{item.display}</span>
              <span className="tabular w-10 shrink-0 text-right text-xs text-ink-muted">{total ? Math.round((item.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
        {items.length > visible && (
          <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all}
                  className="mt-3 text-sm font-medium text-accent hover:underline">
            {all ? "Show less" : `Show ${items.length - visible} more`}
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
