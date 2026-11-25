"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { DownloadIcon } from "../icons";
import { useToast } from "../toast";

type Cell = string | number | boolean | null | undefined;

// Every row of a server-paginated list for the current search / filters / sort (the page and page size are dropped):
// the pages are fetched one after another, 100 rows each.
export async function fetchAllRows<T>(path: string, query: Record<string, string | number | undefined | null>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const res = await api.get<{ data: T[]; meta: { total_pages: number } }>(path, { ...query, page, per_page: 100 });
    rows.push(...res.data);
    if (page >= res.meta.total_pages) return rows;
  }
}

const quote = (value: Cell) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// "Export" button beside Columns: downloads the table as a .csv file (opens in Excel) with the columns the user shows,
// in their order, and every row of the list as filtered — not only the page on screen. `rows` is the full list when the
// page has it; else `load` fetches it (fetchAllRows). `value` gives the text of a column for a row.
export function ExportButton<T>({ filename, columns, value, rows, load }: {
  filename: string;
  columns: { key: string; label: string }[];
  value: (row: T, key: string) => Cell;
  rows?: T[];
  load?: () => Promise<T[]>;
}) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const list = rows ?? (load ? await load() : []);
      const lines = [columns.map((c) => quote(c.label)), ...list.map((r) => columns.map((c) => quote(value(r, c.key))))];
      // The BOM makes Excel read the file as UTF-8.
      const blob = new Blob(["﻿" + lines.map((l) => l.join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      notify("The export failed. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={download} disabled={busy} title="Download the table as a .csv file (the columns shown, every row of the list)"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium text-neutral-600 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-60">
      <DownloadIcon size={15} className="text-ink-muted" />
      {busy ? "Exporting…" : "Export"}
    </button>
  );
}
