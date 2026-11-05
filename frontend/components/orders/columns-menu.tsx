"use client";

import { useState } from "react";
import { CheckIcon, TableIcon } from "../icons";
import { useSession } from "../session";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";

// "Columns" button beside Filter on the Orders table: opens the list of the table's columns in the right-hand side
// panel, each ticked when shown (`shown`: what the table shows now, the user's choice or the default columns). Changes
// apply immediately and are saved for the signed-in user (session saveOrdersColumns), so they see the same columns on
// every tab and next time. At least one column stays shown.
export function ColumnsMenu({ columns, shown }: { columns: { key: string; label: string }[]; shown: Set<string> }) {
  const { saveOrdersColumns } = useSession();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const shownCount = columns.filter((c) => shown.has(c.key)).length;

  function toggle(key: string) {
    const next = shown.has(key) ? [...shown].filter((k) => k !== key) : [...shown, key];
    saveOrdersColumns(next).catch(() => notify("The columns could not be saved. Try again.", "error"));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium transition-colors duration-150 ${
          open ? "bg-neutral-100 text-neutral-900" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        }`}
      >
        <TableIcon size={15} className="text-ink-muted" />
        Columns
        <span title={`${shownCount} of ${columns.length} columns shown`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-semibold text-white">
          {shownCount}
        </span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Columns"
        description={`${shownCount} of ${columns.length} columns shown. Changes apply immediately and are saved for you.`}
        icon={<TableIcon size={18} />}
        footer={<Button variant="primary" onClick={() => setOpen(false)}>Done</Button>}
      >
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <div role="group" aria-label="Columns shown" className="divide-y divide-neutral-100">
            {columns.map((column) => {
              const on = shown.has(column.key);
              const last = on && shownCount === 1;
              return (
                <button
                  key={column.key}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={last}
                  title={last ? "At least one column stays shown" : undefined}
                  onClick={() => toggle(column.key)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 ${
                    on ? "font-medium text-ink" : "text-ink-muted"
                  }`}
                >
                  <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    on ? "border-accent bg-accent text-white" : "border-neutral-300"
                  }`}>
                    {on && <CheckIcon size={11} strokeWidth={3} />}
                  </span>
                  {column.label}
                </button>
              );
            })}
          </div>
        </section>
      </Sheet>
    </>
  );
}
