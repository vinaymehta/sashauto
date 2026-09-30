import type { FilterGroup } from "./ui/filter-menu";

// Age group of an order row = days since its ship date:
// 0-30 green, 31-60 yellow, over 60 red; a ship date in the future is uncoloured.
// The server filters with the same rule (param `age`), using the browser's date sent as `today`.
export type AgeGroup = "green" | "yellow" | "red" | null;

export const AGE_ROW: Record<Exclude<AgeGroup, null>, string> = {
  green: "bg-age-green hover:bg-age-green/70",
  yellow: "bg-age-yellow hover:bg-age-yellow/70",
  red: "bg-age-red hover:bg-age-red/70",
};

const AGE_TITLE: Record<Exclude<AgeGroup, null>, string> = {
  green: "Ship date 0–30 days ago",
  yellow: "Ship date 31–60 days ago",
  red: "Ship date over 60 days ago",
};

export const AGE_FILTER: FilterGroup = {
  key: "age",
  label: "Age group",
  options: [
    { value: "green", label: "0–30 days since ship date" },
    { value: "yellow", label: "31–60 days" },
    { value: "red", label: "Over 60 days" },
    { value: "future", label: "Ship date in the future" },
  ],
};

// Today's date in the browser, as YYYY-MM-DD (sent to the server so filter and colours agree).
export function todayParam(today: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

export function ageGroup(shipDate: string, today: Date = new Date()): AgeGroup {
  const [y, m, d] = shipDate.split("-").map(Number);
  const ship = Date.UTC(y!, m! - 1, d!);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((now - ship) / 86_400_000);
  if (days < 0) return null;
  if (days <= 30) return "green";
  if (days <= 60) return "yellow";
  return "red";
}

// Row props for a table row: the age tint (or the neutral hover) plus an explanatory tooltip.
export function ageRowProps(shipDate: string, today: Date, neutral = "hover:bg-neutral-50/50") {
  const age = ageGroup(shipDate, today);
  return { className: `transition-colors duration-150 ${age ? AGE_ROW[age] : neutral}`, title: age ? AGE_TITLE[age] : undefined };
}

export function AgeLegend() {
  const items: [string, string][] = [
    ["bg-age-green border-age-green-ink/30", "0–30 days since ship date"],
    ["bg-age-yellow border-age-yellow-ink/30", "31–60 days"],
    ["bg-age-red border-age-red-ink/30", "Over 60 days"],
    ["bg-white border-neutral-300", "Ship date in the future"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line bg-white px-6 py-2.5 text-xs text-ink-muted">
      <span className="font-medium text-ink">Age</span>
      {items.map(([swatch, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`h-3 w-3 rounded-sm border ${swatch}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
