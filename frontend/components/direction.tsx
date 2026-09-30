import type { Direction } from "@/lib/types";
import { formatDifference } from "@/lib/format";
import { ArrowDownIcon, ArrowUpIcon } from "./icons";

// The one quantity-change indicator used everywhere: ↑ +50 or ↓ -30 (arrow, sign and colour).
export function ChangeValue({ direction, difference, className = "" }: { direction: Direction; difference: string; className?: string }) {
  const up = direction === "increase";
  return (
    <span className={`tabular inline-flex items-center justify-end gap-1 font-semibold ${up ? "text-inc" : "text-dec"} ${className}`}>
      {up ? <ArrowUpIcon size={14} strokeWidth={2.25} aria-label="up" /> : <ArrowDownIcon size={14} strokeWidth={2.25} aria-label="down" />}
      {formatDifference(difference)}
    </span>
  );
}

// Arrow only, for the Change column next to a separate Difference column.
export function ChangeArrow({ direction }: { direction: Direction }) {
  const up = direction === "increase";
  return (
    <span className={`inline-flex items-center justify-center ${up ? "text-inc" : "text-dec"}`} title={up ? "Quantity up" : "Quantity down"}>
      {up ? <ArrowUpIcon size={16} strokeWidth={2.5} aria-label="Quantity up" /> : <ArrowDownIcon size={16} strokeWidth={2.5} aria-label="Quantity down" />}
    </span>
  );
}
