"use client";

import type { OrderHistory, OrderRow } from "@/lib/types";
import { formatDate, formatQty } from "@/lib/format";
import { ageRowProps } from "../age";
import { useApi } from "../use-api";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { Sheet } from "../ui/sheet";
import { HistoryIcon } from "../icons";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const qty = (value: string | null) => (value === null ? <span className="text-neutral-300">—</span> : formatQty(value));

// Original imported cell value, lightly formatted for reading (blank cells shown as a dash).
export function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return <span className="text-neutral-300">—</span>;
  }
  if (typeof value === "string" && ISO_DATE.test(value)) return formatDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.replace("T", " ").slice(0, 16);
  return typeof value === "string" ? value.trim() : value.toLocaleString("en-US");
}

// History of one current order row in the right-hand side panel: the current row first, then the other
// rows with the same PO Number + Part Number + Type (never another Type), newest Ship Date first.
// Loaded when the panel opens.
export function HistoryPanel({ row, today, onClose }: { row: OrderRow; today: Date; onClose: () => void }) {
  const { data, error, loading } = useApi<OrderHistory>(`/api/orders/${row.id}/history`);
  const count = data?.data.length;
  const th = "h-9 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-4 text-2xs font-bold uppercase tracking-wider text-neutral-600";
  const td = "tabular h-10 whitespace-nowrap border-b border-neutral-100 px-4";

  return (
    <Sheet
      open
      onClose={onClose}
      title="History"
      description={<>
        <span className="font-medium text-ink">{row.order_type}</span> only
        {count !== undefined && <> · {count === 0 ? "no other rows" : `${count} earlier row${count === 1 ? "" : "s"}, newest ship date first`}</>}
      </>}
      icon={<HistoryIcon size={18} />}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <div className="border-r border-neutral-100 px-5 py-3">
            <dt className="text-xs font-medium text-ink-muted">PO Number</dt>
            <dd className="mt-0.5 font-semibold text-ink">{row.po_number}</dd>
          </div>
          <div className="px-5 py-3">
            <dt className="text-xs font-medium text-ink-muted">Part Number</dt>
            <dd className="mt-0.5 font-semibold text-ink">{row.part_number}</dd>
          </div>
        </dl>

        {error ? (
          <Alert title="Could not load the history">{error.message}</Alert>
        ) : loading && !data ? (
          <Skeleton className="h-32 w-full" />
        ) : data ? (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>Ship Date</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>Previous Qty</th>
                </tr>
              </thead>
              <tbody>
                {[row, ...data.data].map((r) => {
                  const current = r.id === row.id;
                  const tint = ageRowProps(r.ship_date, today, "hover:bg-neutral-50");
                  return (
                    <tr key={r.id} className={`${tint.className} ${current ? "font-semibold shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`} title={tint.title}>
                      <td className={`${td} text-ink`}>
                        {formatDate(r.ship_date)}
                        {current && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-accent">Current</span>}
                      </td>
                      <td className={`${td} text-right text-ink`}>{qty(r.qty)}</td>
                      <td className={`${td} text-right text-ink-muted`}>{qty(r.previous_qty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
