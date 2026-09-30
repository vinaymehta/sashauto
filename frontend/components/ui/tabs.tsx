"use client";

import type { ReactNode } from "react";

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
  count?: number | null;
}

// Flat underline tabs: inactive tabs are muted text, the active tab gets a 2px bottom border accent and bold text.
export function Tabs<K extends string>({ tabs, active, onChange }: { tabs: TabItem<K>[]; active: K; onChange: (key: K) => void }) {
  return (
    <div role="tablist" className="flex gap-1">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={`relative flex h-11 items-center gap-2 px-4 text-sm transition-colors duration-150 ${
              selected
                ? "border-b-2 border-neutral-900 font-semibold text-ink"
                : "border-b-2 border-transparent font-medium text-ink-muted hover:text-ink"
            }`}
          >
            {tab.icon && <span className={selected ? "text-tint-violet-ink" : "text-ink-faint"}>{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && tab.count !== null && (
              <span className={`tabular min-w-5 rounded-full px-1.5 py-px text-center text-2xs font-semibold ${
                selected ? "bg-tint-violet text-tint-violet-ink" : "bg-neutral-200/80 text-neutral-500"
              }`}>
                {tab.count.toLocaleString("en-US")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
