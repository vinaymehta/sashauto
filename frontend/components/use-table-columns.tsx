"use client";

import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useSession } from "./session";
import { Th } from "./ui/table";

export interface ColumnDef {
  key: string;
  label: string; // in the Columns panel (and the header, unless the table draws its own)
  sort?: string; // the server sort key of a sortable column
  align?: "left" | "center" | "right";
}

// The columns of one table as the signed-in user wants them (Columns panel: shown or hidden, in their order; saved per
// user under the table's name). `columns` are all the table's columns; `defaults` the keys shown until the user chooses
// (all of them when omitted). Keys the table no longer has are left out and new columns not chosen yet stay hidden.
// Returns `shown` (the columns to draw, in order), the props of <ColumnsMenu> (`menu`, with the Arrange button) and
// `head(column, header)`: the header cell to draw — while Arrange is on, a drag handle (the headers do not sort then, so
// a drag never sorts by mistake); otherwise `header`, the table's own. A drop saves the new order for the user.
export function useTableColumns<C extends ColumnDef>(table: string, columns: C[], defaults?: string[]) {
  const { user, saveTableColumns, saveOrdersColumns } = useSession();
  const chosen = user?.table_columns?.[table];
  const defaultKeys = useMemo(() => defaults ?? columns.map((c) => c.key), [defaults, columns]);
  const saved = useMemo(() => {
    const keys = new Set(columns.map((c) => c.key));
    return chosen && chosen.some((k) => keys.has(k)) ? chosen : defaultKeys;
  }, [chosen, columns, defaultKeys]);
  const shown = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    return saved.flatMap((k) => byKey.get(k) ?? []);
  }, [columns, saved]);
  const shownKeys = shown.map((c) => c.key);

  const [arranging, setArranging] = useState(false);
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<{ key: string; after: boolean } | null>(null);
  const endDrag = () => { setDragColumn(null); setDropColumn(null); };

  function drop() {
    if (dragColumn && dropColumn) {
      const order = shownKeys.filter((k) => k !== dragColumn);
      order.splice(order.indexOf(dropColumn.key) + (dropColumn.after ? 1 : 0), 0, dragColumn);
      if (order.join("\u0000") !== shownKeys.join("\u0000")) {
        // Only the shown columns change place in the saved list (it keeps the hidden ones where they were).
        const shownSet = new Set(shownKeys);
        const rest = [...order];
        const next = saved.map((k) => (shownSet.has(k) ? rest.shift()! : k));
        (table === "orders" ? saveOrdersColumns(next) : saveTableColumns(table, next)).catch(() => undefined);
      }
    }
    endDrag();
  }

  const head = (c: ColumnDef, header: ReactNode): ReactNode => {
    if (!arranging) return header;
    return (
      <Th key={c.key} align={c.align} draggable title="Drag to move this column"
          onDragStart={(e: DragEvent<HTMLTableCellElement>) => { setDragColumn(c.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.key); }}
          onDragOver={(e: DragEvent<HTMLTableCellElement>) => {
            if (!dragColumn || dragColumn === c.key) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const after = e.clientX > rect.left + rect.width / 2;
            if (dropColumn?.key !== c.key || dropColumn.after !== after) setDropColumn({ key: c.key, after });
          }}
          onDrop={(e: DragEvent<HTMLTableCellElement>) => { e.preventDefault(); drop(); }}
          onDragEnd={endDrag}
          className={`relative cursor-grab ${dragColumn === c.key ? "opacity-40" : ""} ${dropColumn?.key === c.key
            ? `after:absolute after:inset-y-1 after:w-0.5 after:bg-accent ${dropColumn.after ? "after:right-0" : "after:left-0"}` : ""}`}>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="text-neutral-400">⋮⋮</span>{c.label}</span>
      </Th>
    );
  };

  const menu = {
    table, columns, shown: shownKeys, saved, defaults: defaultKeys,
    arrange: { on: arranging, toggle: () => { setArranging((on) => !on); endDrag(); } },
  };
  return { shown, head, menu };
}
