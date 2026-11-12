"use client";

import { useState, type DragEvent } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, TableIcon } from "../icons";
import { useSession } from "../session";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";

// Six dots: the handle a shown column is dragged by.
const Grip = () => (
  <svg width={12} height={14} viewBox="0 0 12 14" fill="currentColor" aria-hidden>
    <circle cx="3.5" cy="3" r="1.25" /><circle cx="8.5" cy="3" r="1.25" />
    <circle cx="3.5" cy="7" r="1.25" /><circle cx="8.5" cy="7" r="1.25" />
    <circle cx="3.5" cy="11" r="1.25" /><circle cx="8.5" cy="11" r="1.25" />
  </svg>
);

// "Columns" button beside Filter on the Orders table: opens the list of the table's columns in the right-hand side
// panel, each ticked when shown (`shown`: the keys the table shows now, in its order — the user's choice or the default
// columns). The shown ones come first in that order and can be dragged (or moved with the arrows) to reorder the table;
// the hidden ones follow in file order, and a ticked one goes last. Changes are made to a draft and saved for the
// signed-in user with Save (session saveOrdersColumns), so they see the same columns on every tab and next time; closing
// the panel otherwise drops them. At least one column stays shown. `saved` is the list the change is made to: it also
// keeps the columns other files have. Default puts the default columns (`defaults`) in the draft; saved, the user's own
// choice is cleared, so they follow the default columns again.
export function ColumnsMenu({ columns, shown, saved, defaults }: {
  columns: { key: string; label: string }[]; shown: string[]; saved: string[]; defaults: string[];
}) {
  const { saveOrdersColumns } = useSession();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  // The list being edited in the panel (null: nothing changed yet), saved with Save.
  const [draft, setDraft] = useState<string[] | null>(null);
  // The draft is the default columns (Default clicked, nothing changed after).
  const [toDefault, setToDefault] = useState(false);
  // Shown column being dragged, and where it would be dropped (an index in `shown`: it goes before that column).
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  // In the panel: the draft (or what is saved), and its shown columns of this file in order.
  const base = draft ?? saved;
  const current = draft ? draft.filter((k) => byKey.has(k)) : shown;
  const shownCount = current.length;
  const listed = [...current.flatMap((key) => byKey.get(key) ?? []), ...columns.filter((c) => !current.includes(c.key))];

  const edit = (next: string[]) => { setDraft(next); setToDefault(false); };
  const openPanel = () => { setDraft(null); setToDefault(false); setOpen(true); };
  const closePanel = () => { setOpen(false); setDraft(null); setToDefault(false); };
  const isDefault = current.join("\u0000") === defaults.filter((k) => byKey.has(k)).join("\u0000");

  function save() {
    if (draft) saveOrdersColumns(toDefault ? null : draft).catch(() => notify("The columns could not be saved. Try again.", "error"));
    closePanel();
  }

  function applyDefaults() {
    setDraft([...defaults]);
    setToDefault(true);
  }

  function toggle(key: string) {
    edit(current.includes(key) ? base.filter((k) => k !== key) : [...base, key]);
  }

  // Moves a shown column to before `at` (shown.length = last). Only this file's columns change place in the saved list.
  function moveTo(key: string, at: number) {
    const from = current.indexOf(key);
    const order = current.filter((k) => k !== key);
    order.splice(at > from ? at - 1 : at, 0, key);
    if (order.join("\u0000") === current.join("\u0000")) return;
    const rest = [...order];
    edit(base.map((k) => (byKey.has(k) ? rest.shift()! : k)));
  }

  // Over a shown column: before or after it, by the pointer's half; over a hidden one: after the last shown column.
  function dragOver(e: DragEvent<HTMLDivElement>, index: number) {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const at = index >= shownCount ? shownCount : e.clientY < rect.top + rect.height / 2 ? index : index + 1;
    if (at !== dropAt) setDropAt(at);
  }

  function endDrag() {
    setDragging(null);
    setDropAt(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium transition-colors duration-150 ${
          open ? "bg-neutral-100 text-neutral-900" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        }`}
      >
        <TableIcon size={15} className="text-ink-muted" />
        Columns
        <span title={`${shown.length} of ${columns.length} columns shown`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-semibold text-white">
          {shown.length}
        </span>
      </button>

      <Sheet
        open={open}
        onClose={closePanel}
        title="Columns"
        description={`${shownCount} of ${columns.length} columns shown. Tick the ones to show and drag them to change their order, then Save.`}
        icon={<TableIcon size={18} />}
        footer={
          <>
            <Button onClick={applyDefaults} disabled={isDefault} className="mr-auto"
                    title="Show the default columns in their default order (then Save)">Default</Button>
            <Button variant="ghost" onClick={closePanel}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!draft}>Save</Button>
          </>
        }
      >
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <div role="group" aria-label="Columns shown" className="divide-y divide-neutral-100">
            {listed.map((column, index) => {
              const on = index < shownCount;
              const last = on && shownCount === 1;
              return (
                <div
                  key={column.key}
                  draggable={on}
                  onDragStart={on ? (e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", column.key);
                    setDragging(column.key);
                  } : undefined}
                  onDragOver={(e) => dragOver(e, index)}
                  onDrop={(e) => {
                    if (!dragging || dropAt === null) return;
                    e.preventDefault();
                    moveTo(dragging, dropAt);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  className={`relative flex items-center ${dragging === column.key ? "opacity-50" : ""}`}
                >
                  {/* Drop indicator: above this column, or below the last shown one. */}
                  {dragging && (dropAt === index || (dropAt === shownCount && index === shownCount - 1)) && (
                    <span aria-hidden className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-accent ${dropAt === index ? "-top-px" : "-bottom-px"}`} />
                  )}
                  <span aria-hidden title={on ? "Drag to reorder" : undefined}
                        className={`flex w-7 shrink-0 justify-end ${on ? "cursor-grab text-neutral-400 active:cursor-grabbing" : "invisible"}`}>
                    <Grip />
                  </span>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={last}
                    title={last ? "At least one column stays shown" : undefined}
                    onClick={() => toggle(column.key)}
                    className={`flex min-w-0 flex-1 items-center gap-3 py-2 pl-2 pr-4 text-left text-sm transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 ${
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
                  {/* Keyboard alternative to dragging. */}
                  {on && (
                    <span className="flex shrink-0 items-center gap-0.5 pr-2">
                      <button type="button" aria-label={`Move ${column.label} up`} title="Move up" disabled={index === 0}
                              onClick={() => moveTo(column.key, index - 1)}
                              className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink disabled:pointer-events-none disabled:opacity-30">
                        <ArrowUpIcon size={14} />
                      </button>
                      <button type="button" aria-label={`Move ${column.label} down`} title="Move down" disabled={index === shownCount - 1}
                              onClick={() => moveTo(column.key, index + 2)}
                              className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink disabled:pointer-events-none disabled:opacity-30">
                        <ArrowDownIcon size={14} />
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </Sheet>
    </>
  );
}
