import { ArrowDownIcon, ArrowUpIcon, SortIcon } from "../icons";
import { Th } from "./table";

export type SortDirection = "asc" | "desc";

// Clickable column header. Sorting happens on the server over the whole dataset, then it paginates.
export function SortTh({ label, sortKey, sort, direction, onSort, align = "left", className = "" }: {
  label: string; sortKey: string; sort: string; direction: SortDirection; onSort: (key: string) => void;
  align?: "left" | "center" | "right"; className?: string;
}) {
  const active = sort === sortKey;
  return (
    <Th align={align} className={className} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sortKey)} title={`Sort by ${label}`}
              className={`inline-flex items-center gap-1 font-bold uppercase tracking-wider transition-colors ${
                align === "right" ? "flex-row-reverse" : ""
              } ${active ? "text-neutral-900" : "text-neutral-600 hover:text-neutral-900"}`}>
        {label}
        {active
          ? (direction === "asc" ? <ArrowUpIcon size={12} strokeWidth={2.5} /> : <ArrowDownIcon size={12} strokeWidth={2.5} />)
          : <SortIcon size={12} className="text-neutral-300" />}
      </button>
    </Th>
  );
}
