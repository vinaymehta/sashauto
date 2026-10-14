"use client";

import type { ReactNode } from "react";

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
  count?: number | null;
}

// Flat underline tabs: inactive tabs are muted text, the active tab gets a 2px bottom border accent and bold text.
// On narrow screens the row scrolls sideways instead of running off the edge. `size="lg"`: bigger, bold tab names.
export function Tabs<K extends string>({ tabs, active, onChange, size = "md" }: {
  tabs: TabItem<K>[]; active: K; onChange: (key: K) => void; size?: "md" | "lg";
}) {
  const large = size === "lg";
  return (
    <div role="tablist" className="flex max-w-full gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 transition-colors duration-150 sm:px-4 ${
              large ? "h-12 text-base font-bold" : `h-11 text-sm ${selected ? "font-semibold" : "font-medium"}`} ${
              selected
                ? `border-b-2 border-neutral-900 text-ink ${large ? "border-b-[3px]" : ""}`
                : "border-b-2 border-transparent text-ink-muted hover:text-ink"
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
