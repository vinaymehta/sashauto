import type { ReactNode } from "react";
import { formatCount } from "@/lib/format";

export interface BarItem {
  label: string;
  value: number;
  hint?: string;
  /** Tailwind background class for the bar, e.g. "bg-type-order". Defaults to neutral. */
  color?: string;
  /** Optional icon shown before the label (required when the colour is a status colour). */
  icon?: ReactNode;
}

// Horizontal magnitude bars, each labelled with its value and share. Every bar is directly
// labelled, so identity never depends on colour alone.
export function BarList({ items, total }: { items: BarItem[]; total?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = total ?? items.reduce((a, i) => a + i.value, 0);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-ink" title={item.hint}>
              {item.icon}
              <span className="truncate">{item.label}</span>
            </span>
            <span className="tabular shrink-0 text-ink">
              {formatCount(item.value)}
              <span className="ml-1.5 text-xs text-ink-muted">{sum ? Math.round((item.value / sum) * 100) : 0}%</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div className={`h-full rounded-full transition-[width] duration-500 ${item.color ?? "bg-neutral-400"}`}
                 style={{ width: `${Math.max((item.value / max) * 100, item.value ? 1.5 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
