import type { FilterGroup } from "./ui/filter-menu";

// Age group of an order row = days from today until its ship date:
// 30-45 green, 15-29 yellow, under 15 (or the ship date has passed) red; more than 45 days away is uncoloured.
// Same rule as the server (Ageing::Rules) and the ageing email.
// The server filters with the same rule (param `age`), using the browser's date sent as `today`.
export type AgeGroup = "green" | "yellow" | "red" | null;

export const AGE_ROW: Record<Exclude<AgeGroup, null>, string> = {
  green: "bg-age-green hover:bg-age-green/70",
  yellow: "bg-age-yellow hover:bg-age-yellow/70",
  red: "bg-age-red hover:bg-age-red/70",
};

const AGE_TITLE: Record<Exclude<AgeGroup, null>, string> = {
  green: "Ship date 30–45 days away",
  yellow: "Ship date 15–29 days away",
  red: "Ship date under 15 days away, or overdue",
};

export const AGE_FILTER: FilterGroup = {
  key: "age",
  label: "Age group",
  options: [
    { value: "red", label: "Under 15 days to ship date or overdue" },
    { value: "yellow", label: "15–29 days to ship date" },
    { value: "green", label: "30–45 days to ship date" },
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
  const daysUntil = Math.round((ship - now) / 86_400_000);
  if (daysUntil > 45) return null;
  if (daysUntil >= 30) return "green";
  if (daysUntil >= 15) return "yellow";
  return "red";
}

// Row props for a table row: the age tint (or the neutral hover) plus an explanatory tooltip.
export function ageRowProps(shipDate: string, today: Date, neutral = "hover:bg-neutral-50/50") {
  const age = ageGroup(shipDate, today);
  return { className: `transition-colors duration-150 ${age ? AGE_ROW[age] : neutral}`, title: age ? AGE_TITLE[age] : undefined };
}

export function AgeLegend() {
  const items: [string, string][] = [
    ["bg-age-red border-age-red-ink/30", "Under 15 days to ship date or overdue"],
    ["bg-age-yellow border-age-yellow-ink/30", "15–29 days"],
    ["bg-age-green border-age-green-ink/30", "30–45 days"],
    ["bg-white border-neutral-300", "More than 45 days"],
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
