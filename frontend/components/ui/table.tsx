import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import type { PageMeta } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";

// `dense` tightens horizontal cell padding for wide data grids. `fixed` makes a <colgroup> set exact
// column proportions instead of letting content decide.
export function Table({ children, dense = false, fixed = false }: { children: ReactNode; dense?: boolean; fixed?: boolean }) {
  return (
    <div className="animate-fade-in overflow-x-auto">
      <table className={`w-full border-collapse text-base ${fixed ? "min-w-[720px] table-fixed" : ""} ${dense ? "[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-6 [&_th:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:last-child]:pr-6" : ""}`}>{children}</table>
    </div>
  );
}

type Align = "left" | "center" | "right";
const ALIGN: Record<Align, string> = { left: "text-left", center: "text-center", right: "text-right" };

export function Th({ align = "left", className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      className={`h-10 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-6 text-xs font-bold uppercase tracking-wider text-neutral-800 ${ALIGN[align]} ${className}`}
      {...props}
    />
  );
}

export function Td({ align = "left", className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <td
      className={`h-12 whitespace-nowrap border-b border-neutral-100 px-6 text-ink transition-colors ${align === "right" ? "tabular text-right" : align === "center" ? "text-center" : ""} ${className}`}
      {...props}
    />
  );
}

// Page numbers to show: always first and last, the current page and its neighbours, "…" for gaps.
function pageItems(page: number, total: number): (number | "gap")[] {
  const pages = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  if (page <= 3) [2, 3, 4].forEach((p) => p <= total && pages.add(p));
  if (page >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => p >= 1 && pages.add(p));
  const sorted = [...pages].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) items.push("gap");
    items.push(p);
  });
  return items;
}

const PER_PAGE_OPTIONS = [10, 25, 50, 100];

// Pagination bar driven entirely by the server's meta (page, per_page, total, total_pages, from, to).
export function Pagination({ meta, onPage, onPerPage, noun = "rows" }: {
  meta: PageMeta;
  onPage: (page: number) => void;
  onPerPage?: (perPage: number) => void;
  noun?: string;
}) {
  if (meta.total === 0) return null;
  const pageButton = "flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm tabular transition-colors duration-150";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4 text-sm text-ink-muted">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="tabular">
          Showing <span className="font-medium text-ink">{formatCount(meta.from)}–{formatCount(meta.to)}</span> of{" "}
          <span className="font-medium text-ink">{formatCount(meta.total)}</span> {noun}
        </span>
        {onPerPage && (
          <label className="flex items-center gap-2">
            Rows per page
            <select value={meta.per_page} onChange={(e) => onPerPage(Number(e.target.value))}
                    className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm text-ink transition-colors hover:border-neutral-400 focus:border-neutral-900 focus:outline-none">
              {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>

      {meta.total_pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <button type="button" onClick={() => onPage(meta.page - 1)} disabled={meta.page <= 1} aria-label="Previous page"
                  className={`${pageButton} text-ink hover:bg-subtle disabled:text-ink-faint disabled:hover:bg-transparent`}>
            <ChevronLeftIcon size={16} />
          </button>
          {pageItems(meta.page, meta.total_pages).map((item, i) =>
            item === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-ink-faint">…</span>
            ) : (
              <button key={item} type="button" onClick={() => onPage(item)} aria-current={item === meta.page ? "page" : undefined}
                      className={`${pageButton} ${item === meta.page ? "bg-accent font-medium text-white" : "text-neutral-700 hover:bg-neutral-100"}`}>
                {item}
              </button>
            ),
          )}
          <button type="button" onClick={() => onPage(meta.page + 1)} disabled={meta.page >= meta.total_pages} aria-label="Next page"
                  className={`${pageButton} text-ink hover:bg-subtle disabled:text-ink-faint disabled:hover:bg-transparent`}>
            <ChevronRightIcon size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
