"use client";

import { useState } from "react";
import { CheckIcon, CloseIcon, FilterIcon } from "../icons";
import { Button } from "./button";
import { Sheet } from "./sheet";

export interface FilterGroup {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** For sort-style groups: the option used when nothing is chosen (no "All" entry is shown). */
  defaultValue?: string;
}

export type FilterValues = Record<string, string>;

// A group counts as active only when it differs from its default.
const isActive = (g: FilterGroup, values: FilterValues) => !!values[g.key] && values[g.key] !== g.defaultValue;

// "Filter" button that opens the filters in the right-hand side panel. Choices apply immediately;
// "" means no filter for that group. Active filters are listed as removable chips by <FilterChips>.
export function FilterMenu({ groups, values, onChange, onClear }: {
  groups: FilterGroup[];
  values: FilterValues;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const active = groups.filter((g) => isActive(g, values)).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium transition-colors duration-150 ${
          open ? "bg-neutral-100 text-neutral-900" : active ? "text-neutral-900 hover:bg-neutral-100" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        }`}
      >
        <FilterIcon size={15} className="text-ink-muted" />
        Filter
        {active > 0 && (
          <span className="flex h-5 min-w-5 animate-pop-in items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-semibold text-white">
            {active}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        description={active ? `${active} filter${active === 1 ? "" : "s"} applied. Changes apply immediately.` : "Changes apply immediately."}
        icon={<FilterIcon size={18} />}
        footer={
          <>
            <Button variant="ghost" onClick={onClear} disabled={!active}>Clear all</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Done</Button>
          </>
        }
      >
        <div className="space-y-4">
          {groups.map((group) => {
            const options = group.defaultValue !== undefined ? group.options : [{ value: "", label: "All" }, ...group.options];
            return (
              <section key={group.key} className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
                <h3 className="border-b border-neutral-100 px-5 py-3 text-sm font-semibold text-ink">{group.label}</h3>
                <div role="radiogroup" aria-label={group.label} className="divide-y divide-neutral-100">
                  {options.map((option) => {
                    const selected = (values[group.key] || group.defaultValue || "") === option.value;
                    return (
                      <button
                        key={option.value || "all"}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(group.key, option.value === group.defaultValue ? "" : option.value)}
                        className={`flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left text-sm transition-colors hover:bg-neutral-50 ${
                          selected ? "font-medium text-ink" : "text-ink-muted"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                            selected ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
                          }`}>
                            {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </span>
                          {option.label}
                        </span>
                        {selected && <CheckIcon size={14} className="text-ink" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}

export function FilterChips({ groups, values, onChange, onClear }: {
  groups: FilterGroup[];
  values: FilterValues;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const chips = groups.flatMap((g) => {
    const option = isActive(g, values) ? g.options.find((o) => o.value === values[g.key]) : undefined;
    return option ? [{ key: g.key, label: `${g.label}: ${option.label}` }] : [];
  });
  if (chips.length === 0) return null;

  return (
    <div className="flex animate-fade-in flex-wrap items-center gap-2 border-b border-line bg-neutral-50 px-6 py-2.5">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-md border border-neutral-900 bg-white py-0.5 pl-2.5 pr-1 text-xs font-medium text-neutral-900">
          {chip.label}
          <button type="button" onClick={() => onChange(chip.key, "")} aria-label={`Remove filter ${chip.label}`}
                  className="rounded-full p-0.5 text-ink-faint transition-colors hover:bg-subtle hover:text-ink">
            <CloseIcon size={12} />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">
        Clear all
      </button>
    </div>
  );
}
