"use client";

import type { OrderHistory, OrderRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { ageRowProps } from "../age";
import { useApi } from "../use-api";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { Sheet } from "../ui/sheet";
import { HistoryIcon } from "../icons";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Original imported cell value, lightly formatted for reading (blank cells shown as a dash).
export function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return <span className="text-neutral-300">—</span>;
  }
  if (typeof value === "string" && ISO_DATE.test(value)) return formatDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.replace("T", " ").slice(0, 16);
  return typeof value === "string" ? value.trim() : value.toLocaleString("en-US");
}

// History of one current order row in the right-hand side panel: the other rows with the same
// PO Number + Part Number + Type (never another Type), with every imported Excel column.
// Loaded from the server when the panel opens.
export function HistoryPanel({ row, top, today, onClose }: { row: OrderRow; top: number; today: Date; onClose: () => void }) {
  const { data, error, loading } = useApi<OrderHistory>(`/api/orders/${row.id}/history`);
  const count = data?.data.length;

  return (
    <Sheet
      open
      wide
      top={top}
      onClose={onClose}
      title={`History · PO ${row.po_number} · Part ${row.part_number}`}
      description={<>
        <span className="font-medium text-ink">{row.order_type}</span> only
        {count !== undefined && <> · {count === 0 ? "no other rows" : `${count} earlier row${count === 1 ? "" : "s"}, newest ship date first`}</>}
      </>}
      icon={<HistoryIcon size={18} />}
    >
      {error ? (
        <Alert title="Could not load the history">{error.message}</Alert>
      ) : loading && !data ? (
        <div className="space-y-2"><Skeleton className="h-4 w-64" /><Skeleton className="h-24 w-full" /></div>
      ) : data && data.data.length === 0 ? (
        <p className="rounded-lg border border-line bg-white px-5 py-6 text-sm text-ink-muted shadow-card">
          This is the only {row.order_type} row for this PO and Part.
        </p>
      ) : data ? (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 h-9 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-3 text-right text-2xs font-bold uppercase tracking-wider text-neutral-600">Excel Row</th>
                {data.headers.map((h) => (
                  <th key={h} className="sticky top-0 h-9 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-3 text-left text-2xs font-bold uppercase tracking-wider text-neutral-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((r) => {
                const tint = ageRowProps(r.ship_date, today, "hover:bg-neutral-50");
                return (
                  <tr key={r.id} className={tint.className} title={tint.title}>
                    <td className="tabular h-10 whitespace-nowrap border-b border-neutral-100 px-3 text-right text-ink-muted">{r.source_row_number}</td>
                    {data.headers.map((h) => (
                      <td key={h} className="h-10 max-w-72 truncate whitespace-nowrap border-b border-neutral-100 px-3 text-ink" title={String(r.source_data?.[h] ?? "")}>
                        {cell(r.source_data?.[h])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Sheet>
  );
}
