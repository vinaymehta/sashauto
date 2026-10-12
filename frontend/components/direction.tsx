import type { Direction } from "@/lib/types";
import { formatDifference } from "@/lib/format";
import { ArrowDownIcon, ArrowUpIcon } from "./icons";

// Colour of a change by its sign: up green, down red, a 0 change (an added/removed blank-Qty row) neutral.
function tone(difference: string) {
  const n = Number(difference);
  return n > 0 ? "text-inc" : n < 0 ? "text-dec" : "text-ink-muted";
}

// The one quantity-change indicator used everywhere: ↑ +50 or ↓ -30 (arrow, sign and colour).
export function ChangeValue({ direction, difference, className = "" }: { direction: Direction; difference: string; className?: string }) {
  const n = Number(difference);
  return (
    <span className={`tabular inline-flex items-center justify-end gap-1 font-semibold ${tone(difference)} ${className}`}>
      {n > 0 ? <ArrowUpIcon size={14} strokeWidth={2.25} aria-label="up" /> : n < 0 ? <ArrowDownIcon size={14} strokeWidth={2.25} aria-label="down" /> : null}
      {direction === "added" || direction === "removed" || direction === "rescheduled" ? `${formatDifference(difference)} ${direction}` : formatDifference(difference)}
    </span>
  );
}

// The Change column next to a separate Difference column: an arrow for Qty up/down, a label for rows added/removed.
export function ChangeArrow({ direction, difference }: { direction: Direction; difference: string }) {
  if (direction === "added" || direction === "removed" || direction === "rescheduled") {
    const label = { added: "Added", removed: "Removed", rescheduled: "Rescheduled" }[direction];
    return <span className={`text-xs font-semibold ${tone(difference)}`}>{label}</span>;
  }
  const up = direction === "increase";
  return (
    <span className={`inline-flex items-center justify-center ${up ? "text-inc" : "text-dec"}`} title={up ? "Quantity up" : "Quantity down"}>
      {up ? <ArrowUpIcon size={16} strokeWidth={2.5} aria-label="Quantity up" /> : <ArrowDownIcon size={16} strokeWidth={2.5} aria-label="Quantity down" />}
    </span>
  );
}
