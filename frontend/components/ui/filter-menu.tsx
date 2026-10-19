"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { CheckIcon, ChevronDownIcon, CloseIcon, FilterIcon } from "../icons";
import { Button } from "./button";
import { DatePicker } from "./date-picker";
import { Sheet } from "./sheet";

export interface FilterGroup {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** For sort-style groups: the option used when nothing is chosen (no "All" entry is shown). */
  defaultValue?: string;
  /** "date-range" renders From/To date inputs stored under `${key}_from` / `${key}_to`. */
  type?: "choice" | "date-range";
  /** Heading the group is listed under in the panel (shown where it changes). */
  section?: string;
}

export type FilterValues = Record<string, string>;

// Choice groups allow several options at once; their value is the selected options joined by commas.
// Sort-style groups (with a defaultValue) stay single-choice.
const isMulti = (g: FilterGroup) => g.type !== "date-range" && g.defaultValue === undefined;
const selectedValues = (value: string | undefined) => (value ? value.split(",").filter(Boolean) : []);

// A group counts as active only when it differs from its default.
const isActive = (g: FilterGroup, values: FilterValues) =>
  g.type === "date-range"
    ? !!(values[`${g.key}_from`] || values[`${g.key}_to`])
    : !!values[g.key] && values[g.key] !== g.defaultValue;

function DateRange({ group, values, onChange }: { group: FilterGroup; values: FilterValues; onChange: (key: string, value: string) => void }) {
  const from = values[`${group.key}_from`] ?? "";
  const to = values[`${group.key}_to`] ?? "";
  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-3">
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-ink-muted">From</span>
        <DatePicker value={from} max={to || undefined} clearable placeholder="Any" aria-label={`${group.label} from`} className="w-full text-sm"
                    onChange={(day) => onChange(`${group.key}_from`, day)} />
      </div>
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-ink-muted">To</span>
        <DatePicker value={to} min={from || undefined} clearable placeholder="Any" aria-label={`${group.label} to`} className="w-full text-sm"
                    onChange={(day) => onChange(`${group.key}_to`, day)} />
      </div>
    </div>
  );
}

// "Filter" button that opens the filters in the right-hand side panel, each group a dropdown (FilterSection).
// Choices apply immediately; "" means no filter for that group. Choice groups are multi-select (checkboxes,
// "All" clears the group). Active filters are listed as removable chips by <FilterChips>.
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
        <div className="space-y-3">
          {groups.map((group, i) => (
            <div key={group.key}>
              {group.section && group.section !== groups[i - 1]?.section && (
                <h4 className={`mb-2 px-1 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint ${i > 0 ? "mt-6" : ""}`}>{group.section}</h4>
              )}
              <FilterSection group={group} values={values} onChange={onChange} />
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}

const SEARCH_FROM = 8; // options from which a group gets a search box
const DROPDOWN_FROM = 5; // options from which a group opens and closes (shorter lists and date ranges are always shown)

// One filter group. Groups with few options, and date ranges, are shown directly; longer lists are a dropdown whose
// header shows what is chosen (open at first when the group is in use). Long lists get a search box and scroll.
function FilterSection({ group, values, onChange }: { group: FilterGroup; values: FilterValues; onChange: (key: string, value: string) => void }) {
  const dropdown = group.type !== "date-range" && group.options.length >= DROPDOWN_FROM;
  const [expanded, setExpanded] = useState(() => isActive(group, values));
  const open = !dropdown || expanded;
  const [query, setQuery] = useState("");
  const multi = isMulti(group);
  const chosen = selectedValues(values[group.key]);
  const searchable = group.type !== "date-range" && group.options.length >= SEARCH_FROM;
  const term = query.trim().toLowerCase();
  const all = group.defaultValue !== undefined ? group.options : [{ value: "", label: "All" }, ...group.options];
  const options = term ? all.filter((o) => o.value !== "" && o.label.toLowerCase().includes(term)) : all;
  const summary = group.type === "date-range"
    ? (isActive(group, values) ? "Set" : "Any")
    : multi
      ? (chosen.length === 0 ? "All" : chosen.length === 1 ? group.options.find((o) => o.value === chosen[0])?.label ?? "1 selected" : `${chosen.length} selected`)
      : group.options.find((o) => o.value === (values[group.key] || group.defaultValue))?.label ?? "";

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      {dropdown ? (
        <button type="button" onClick={() => setExpanded((o) => !o)} aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-neutral-50">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{group.label}</span>
          <span className={`ml-auto min-w-0 truncate text-sm ${isActive(group, values) ? "font-medium text-accent" : "text-ink-faint"}`}>{summary}</span>
          <ChevronDownIcon size={16} className={`shrink-0 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      ) : (
        <h3 className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">{group.label}</h3>
      )}
      {open && (
        <div className="border-t border-neutral-100">
          {group.type === "date-range" ? <DateRange group={group} values={values} onChange={onChange} /> : (
            <>
              {searchable && (
                <div className="border-b border-neutral-100 px-3 py-2">
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${group.label.toLowerCase()}`}
                         aria-label={`Search ${group.label}`}
                         className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-tint-violet-ink/60 focus:outline-none" />
                </div>
              )}
              <div role={multi ? "group" : "radiogroup"} aria-label={group.label} className="max-h-72 divide-y divide-neutral-100 overflow-y-auto">
                {options.length === 0 && <p className="px-4 py-3 text-sm text-ink-muted">No match.</p>}
                {options.map((option) => {
                  const selected = multi
                    ? (option.value === "" ? chosen.length === 0 : chosen.includes(option.value))
                    : (values[group.key] || group.defaultValue || "") === option.value;
                  const choose = () => {
                    if (!multi) return onChange(group.key, option.value === group.defaultValue ? "" : option.value);
                    if (option.value === "") return onChange(group.key, "");
                    const next = selected ? chosen.filter((v) => v !== option.value) : [...chosen, option.value];
                    // Keep the options' own order so the value (and URL/cache key) is stable.
                    onChange(group.key, group.options.map((o) => o.value).filter((v) => next.includes(v)).join(","));
                  };
                  return (
                    <button
                      key={option.value || "all"}
                      type="button"
                      role={multi ? "checkbox" : "radio"}
                      aria-checked={selected}
                      onClick={choose}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-50 ${
                        selected ? "font-medium text-ink" : "text-ink-muted"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${
                          multi ? "rounded" : "rounded-full"} ${selected ? "border-accent bg-accent text-white" : "border-neutral-300"
                        }`}>
                          {selected && (multi ? <CheckIcon size={11} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />)}
                        </span>
                        {option.label}
                      </span>
                      {selected && <CheckIcon size={14} className="shrink-0 text-ink" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function FilterChips({ groups, values, onChange, onClear }: {
  groups: FilterGroup[];
  values: FilterValues;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const chips = groups.flatMap((g) => {
    if (!isActive(g, values)) return [];
    if (g.type === "date-range") {
      const from = values[`${g.key}_from`];
      const to = values[`${g.key}_to`];
      const text = from && to ? `${formatDate(from)} – ${formatDate(to)}` : from ? `from ${formatDate(from)}` : `until ${formatDate(to)}`;
      return [{ key: g.key, label: `${g.label}: ${text}`, keys: [`${g.key}_from`, `${g.key}_to`] }];
    }
    const labels = selectedValues(values[g.key]).map((v) => g.options.find((o) => o.value === v)?.label ?? v);
    return labels.length ? [{ key: g.key, label: `${g.label}: ${labels.join(", ")}`, keys: [g.key] }] : [];
  });
  if (chips.length === 0) return null;

  return (
    <div className="flex animate-fade-in flex-wrap items-center gap-2 border-b border-line bg-neutral-50 px-6 py-2.5">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex items-center gap-1 rounded-md border border-neutral-900 bg-white py-0.5 pl-2.5 pr-1 text-xs font-medium text-neutral-900">
          {chip.label}
          <button type="button" onClick={() => chip.keys.forEach((k) => onChange(k, ""))} aria-label={`Remove filter ${chip.label}`}
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
