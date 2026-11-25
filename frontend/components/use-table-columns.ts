"use client";

import { useMemo } from "react";
import { useSession } from "./session";

export interface ColumnDef {
  key: string;
  label: string; // in the Columns panel (and the header, unless the table draws its own)
  sort?: string; // the server sort key of a sortable column
  align?: "left" | "center" | "right";
}

// The columns of one table as the signed-in user wants them (Columns panel: shown or hidden, in their order; saved per
// user under the table's name). `columns` are all the table's columns; `defaults` the keys shown until the user chooses
// (all of them when omitted). Keys the table no longer has are left out and new columns not chosen yet stay hidden.
// Returns `shown` (the columns to draw, in order) and the props of <ColumnsMenu>.
export function useTableColumns<C extends ColumnDef>(table: string, columns: C[], defaults?: string[]) {
  const { user } = useSession();
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
  const menu = { table, columns, shown: shown.map((c) => c.key), saved, defaults: defaultKeys };
  return { shown, has: (key: string) => shown.some((c) => c.key === key), menu };
}
