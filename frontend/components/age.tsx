import { todayIst } from "@/lib/format";
import type { FilterGroup } from "./ui/filter-menu";

// Age group of an order row = days since its Firm Date:
// 30-59 green, 60-89 yellow, 90 or more red; under 30 days, or no Firm Date (Forecast never has one), is uncoloured.
// Same rule as the server (Ageing::Rules) and the ageing email.
// The server filters with the same rule (param `age`), using today's IST date sent as `today`.
export type AgeGroup = "green" | "yellow" | "red" | null;

export const AGE_ROW: Record<Exclude<AgeGroup, null>, string> = {
  green: "bg-age-green hover:bg-age-green/70",
  yellow: "bg-age-yellow hover:bg-age-yellow/70",
  red: "bg-age-red hover:bg-age-red/70",
};

export const AGE_TITLE: Record<Exclude<AgeGroup, null>, string> = {
  green: "30–59 days since Firm Date",
  yellow: "60–89 days since Firm Date",
  red: "90 days or more since Firm Date",
};

export const AGE_FILTER: FilterGroup = {
  key: "age",
  label: "Age group",
  options: [
    { value: "red", label: "90+ days since Firm Date" },
    { value: "yellow", label: "60–89 days since Firm Date" },
    { value: "green", label: "30–59 days since Firm Date" },
  ],
};

// Today's date in IST, as YYYY-MM-DD (sent to the server so filter and colours agree).
export function todayParam(today: Date = new Date()) {
  return todayIst(today);
}

export function ageGroup(firmDate: string | null | undefined, today: Date = new Date()): AgeGroup {
  if (!firmDate) return null;
  const [y, m, d] = firmDate.split("-").map(Number);
  const firm = Date.UTC(y!, m! - 1, d!);
  const [ty, tm, td] = todayIst(today).split("-").map(Number);
  const now = Date.UTC(ty!, tm! - 1, td!);
  const daysSince = Math.round((now - firm) / 86_400_000);
  if (daysSince >= 90) return "red";
  if (daysSince >= 60) return "yellow";
  if (daysSince >= 30) return "green";
  return null;
}

// Row props for a table row: the age tint (or the neutral hover) plus an explanatory tooltip.
export function ageRowProps(firmDate: string | null | undefined, today: Date, neutral = "hover:bg-neutral-50/50") {
  const age = ageGroup(firmDate, today);
  return { className: `transition-colors duration-150 ${age ? AGE_ROW[age] : neutral}`, title: age ? AGE_TITLE[age] : undefined };
}

// The age colours. With `onChange`, each age group is a checkbox that filters the list (the same "age" filter as in the
// Filter panel; `value` is its comma-separated groups); "Under 30 days" is only a colour key.
export function AgeLegend({ value, onChange }: { value?: string; onChange?: (value: string) => void } = {}) {
  const items: [AgeGroup | null, string, string][] = [
    ["red", "bg-age-red border-age-red-ink/30", "90+ days since Firm Date"],
    ["yellow", "bg-age-yellow border-age-yellow-ink/30", "60–89 days"],
    ["green", "bg-age-green border-age-green-ink/30", "30–59 days"],
    [null, "bg-white border-neutral-300", "Under 30 days or no Firm Date"],
  ];
  const chosen = (value ?? "").split(",").filter(Boolean);
  const toggle = (group: string) => {
    const next = chosen.includes(group) ? chosen.filter((g) => g !== group) : [...chosen, group];
    // In the filter's own order, so the value (and URL/cache key) is stable.
    onChange!(AGE_FILTER.options.map((o) => o.value).filter((v) => next.includes(v)).join(","));
  };
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line bg-white px-6 py-2.5 text-xs text-ink-muted">
      <span className="font-medium text-ink">Age</span>
      {items.map(([group, swatch, label]) => {
        if (!group || !onChange) {
          return (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`h-3 w-3 rounded-sm border ${swatch}`} />
              {label}
            </span>
          );
        }
        const on = chosen.includes(group);
        return (
          <label key={label} className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-neutral-50 ${on ? "font-medium text-ink" : ""}`}>
            <input type="checkbox" checked={on} onChange={() => toggle(group)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
            <span aria-hidden className={`h-3 w-3 rounded-sm border ${swatch}`} />
            {label}
          </label>
        );
      })}
    </div>
  );
}
