// Donut chart with a legend: each slice's label, value (`display`) and share. The centre shows `centerLabel` /
// `centerValue` (e.g. the total). Colours repeat after eight slices.
const COLORS = ["#7c3aed", "#d97706", "#0891b2", "#16a34a", "#db2777", "#4f46e5", "#65a30d", "#dc2626"];

export function PieChart({ items, centerLabel, centerValue }: {
  items: { label: string; value: number; display: string; hint?: string }[];
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const radius = 15.9155; // circumference 100, so dash lengths are percentages
  let offset = 25; // start at 12 o'clock

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
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
      <ul className="w-full min-w-0 space-y-2">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-2 text-sm" title={item.hint}>
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-ink">{item.label}</span>
            <span className="tabular shrink-0 text-ink">{item.display}</span>
            <span className="tabular w-10 shrink-0 text-right text-xs text-ink-muted">{total ? Math.round((item.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
