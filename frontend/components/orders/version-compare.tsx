"use client";

import { useState, type ReactNode } from "react";
import type { UploadChoice, VersionDiffLine, VersionDiffPage } from "@/lib/types";
import { formatCount, formatDate, formatDateTime, formatDifference, formatQty } from "@/lib/format";
import { ArrowUpDownIcon } from "../icons";
import { useApi, useDebounced } from "../use-api";
import { useListQuery } from "../use-list-query";
import { Button } from "../ui/button";
import { Alert, EmptyState } from "../ui/feedback";
import { Select } from "../ui/field";
import { SearchInput } from "../ui/search-input";
import { TableSkeleton } from "../ui/skeleton";
import { Pagination } from "../ui/table";
import { RelatedLink } from "./related-popover";

type Kind = VersionDiffLine["direction"];

// Each type of difference: its label (on the line and in the filter chips) and colour.
const KINDS: Record<Kind, { label: string; tone: string }> = {
  increase: { label: "↑ Qty up", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  decrease: { label: "↓ Qty down", tone: "border-red-200 bg-red-50 text-red-700" },
  added: { label: "+ New line", tone: "border-sky-200 bg-sky-50 text-sky-700" },
  removed: { label: "− Line removed", tone: "border-neutral-300 bg-neutral-100 text-neutral-600" },
  rescheduled: { label: "Date moved", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  changed: { label: "Other change", tone: "border-violet-200 bg-violet-50 text-violet-700" },
};
const KIND_ORDER: Kind[] = ["increase", "decrease", "added", "removed", "rescheduled", "changed"];

// A version in the pickers: when it was uploaded first, then its file.
const versionLabel = (u: UploadChoice) => `${formatDateTime(u.completed_at)} · ${u.original_filename}`;

// The cell colours of each side, as a diff checker: old red, new green; a changed value marked stronger.
const SIDE = {
  old: { cell: "bg-red-50/50", mark: "rounded bg-red-100 px-1.5 py-0.5 text-red-800 line-through decoration-red-400/70" },
  new: { cell: "bg-emerald-50/50", mark: "rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800" },
};
const hatch = "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(0_0_0/0.035)_6px,rgb(0_0_0/0.035)_12px)]";

// What one line had in each version: Qty, Ship date and whether each changed.
function sides(line: VersionDiffLine) {
  const qtyChanged = line.direction === "increase" || line.direction === "decrease";
  const dateMoved = line.previous_ship_date !== null;
  return {
    qtyChanged, dateMoved,
    old: { qty: formatQty(line.old_qty), date: formatDate(line.previous_ship_date ?? line.ship_date), missing: line.direction === "added" },
    new: { qty: formatQty(line.new_qty), date: formatDate(line.ship_date), missing: line.direction === "removed" },
  };
}

const Value = ({ side, changed, children }: { side: "old" | "new"; changed: boolean; children: ReactNode }) => (
  <span className={`tabular ${changed ? SIDE[side].mark : "text-ink-muted"}`}>{children}</span>
);

// The change of a line, with its Qty difference next to it.
function ChangeBadge({ line }: { line: VersionDiffLine }) {
  const n = Number(line.difference);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-nowrap">
      <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${KINDS[line.direction].tone}`}>
        {KINDS[line.direction].label}
      </span>
      {n !== 0 && line.direction !== "rescheduled" && (
        <span className={`text-sm font-semibold tabular ${n > 0 ? "text-inc" : "text-dec"}`}>{formatDifference(line.difference)}</span>
      )}
    </span>
  );
}

// Type, Due Date or Ship To changes of a line: old struck red, new green.
function OtherFields({ line }: { line: VersionDiffLine }) {
  if (line.fields.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {line.fields.map((f) => (
        <span key={f.label} className="text-ink-muted">
          {f.label}: <Value side="old" changed>{f.old ?? "—"}</Value> → <Value side="new" changed>{f.new ?? "—"}</Value>
        </span>
      ))}
    </span>
  );
}

// The order line itself: Part (link), description, PO (link) and Type.
function LineInfo({ line, uploadId }: { line: VersionDiffLine; uploadId?: number }) {
  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <RelatedLink kind="part" value={line.part_number} uploadId={uploadId} />
        {line.part_description && <span className="min-w-0 truncate text-sm text-ink-muted" title={line.part_description}>{line.part_description}</span>}
      </span>
      <span className="block text-xs text-ink-muted">
        PO <RelatedLink kind="po" value={line.po_number} uploadId={uploadId} /> · Line {line.po_line_number} · {line.order_type}
      </span>
      <OtherFields line={line} />
    </span>
  );
}

// Orders → Compare versions: two versions (uploads) of the business side by side, like a diff checker. One row per
// order line that differs: the line, then its Qty and Ship date in the old version (red where changed) and in the new
// one (green), and the change with its Qty difference. A fixed layout that wraps, so nothing scrolls sideways; on a
// phone each line is a card with the two versions next to each other. Old starts on the second newest version and New
// on the newest; changing either compares again.
export function VersionCompare({ business }: { business: "dtp" | "gmbh" }) {
  const history = useApi<{ data: UploadChoice[] }>("/api/uploads/history");
  const uploads = (history.data?.data ?? []).filter((u) => u.business === business);
  const list = useListQuery();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [picked, setPicked] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });
  const listed = (id: number | null) => id !== null && uploads.some((u) => u.id === id);
  const from = listed(picked.from) ? picked.from! : uploads[1]?.id ?? null;
  const to = listed(picked.to) ? picked.to! : uploads[0]?.id ?? null;
  const comparable = from !== null && to !== null && from !== to;
  const kind = list.filters.direction;
  const orderType = list.filters.type;

  const { data, error, loading } = useApi<VersionDiffPage>(comparable ? "/api/uploads/compare" : null, {
    from: from ?? undefined, to: to ?? undefined, q, direction: kind, type: orderType, page: list.page, per_page: list.perPage,
  });
  const pick = (key: "from" | "to", id: string) => { setPicked({ from, to, [key]: Number(id) }); list.resetPage(); };
  const swap = () => { setPicked({ from: to, to: from }); list.resetPage(); };
  const total = data ? KIND_ORDER.reduce((sum, k) => sum + (data.meta.counts[k] ?? 0), 0) : 0;
  const oldVersion = uploads.find((u) => u.id === from);
  const newVersion = uploads.find((u) => u.id === to);
  const linkTo = to ?? undefined;

  if (history.error) return <Alert title="Could not load the versions">{history.error.message}</Alert>;
  if (!history.data) return <div className="rounded-lg border border-line bg-surface shadow-card"><TableSkeleton rows={6} columns={4} /></div>;
  if (uploads.length < 2) {
    return (
      <div className="rounded-lg border border-line bg-surface shadow-card">
        <EmptyState title="Two versions are needed to compare" description="Upload another file of this business to see what changed between them." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The two versions: old on the left, new on the right, a swap between them. */}
      <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <VersionBox side="old" id="compare-from" value={from} uploads={uploads} version={oldVersion} onChange={(v) => pick("from", v)} />
        <Button onClick={swap} title="Swap old and new" aria-label="Swap old and new" className="justify-self-center">
          <ArrowUpDownIcon size={15} className="sm:rotate-90" />
        </Button>
        <VersionBox side="new" id="compare-to" value={to} uploads={uploads} version={newVersion} onChange={(v) => pick("to", v)} />
      </div>

      {!comparable ? (
        <Alert tone="info">Choose two different versions.</Alert>
      ) : (
        // Not overflow-hidden: the column headings stick to the top while scrolling.
        <div className="rounded-lg border border-line bg-surface shadow-card">
          {/* How many lines differ, by type; clicking one shows only those lines. Order type selector. */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
            <div className="flex items-center gap-1.5 mr-1">
              <label htmlFor="compare-order-type" className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Type</label>
              <Select id="compare-order-type" value={orderType ?? ""} onChange={(e) => { list.setFilter("type", e.target.value); list.resetPage(); }} className="h-8 py-0 pl-2.5 pr-7 text-xs font-medium w-32">
                <option value="">All Types</option>
                <option value="Order">Order</option>
                <option value="Firm">Firm</option>
                <option value="Forecast">Forecast</option>
              </Select>
            </div>
            <Chip active={!kind} onClick={() => list.setFilter("direction", "")}>All changes · {formatCount(total)}</Chip>
            {data && KIND_ORDER.filter((k) => (data.meta.counts[k] ?? 0) > 0).map((k) => (
              <Chip key={k} active={kind === k} tone={KINDS[k].tone} onClick={() => list.setFilter("direction", kind === k ? "" : k)}>
                {KINDS[k].label} · {formatCount(data.meta.counts[k] ?? 0)}
              </Chip>
            ))}
            <SearchInput label="Search differences" placeholder="Search PO, part number or description" value={search}
                         onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full lg:ml-auto lg:w-72" />
          </div>

          {error ? (
            <div className="p-4"><Alert title="Could not load the comparison">{error.message}</Alert></div>
          ) : loading && !data ? (
            <TableSkeleton rows={8} columns={6} />
          ) : data && data.data.length === 0 ? (
            q || kind || orderType ? (
              <EmptyState title="No differences match" description="Clear the search or the chosen filters to see all differences."
                          action={<Button size="sm" onClick={() => { setSearch(""); list.clearFilters(); }}>Show all differences</Button>} />
            ) : (
              <EmptyState title="No differences" description="These two versions have the same order lines." />
            )
          ) : data ? (
            <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
              {/* From md up: one aligned table. */}
              <table className="hidden w-full table-fixed border-separate border-spacing-0 text-sm md:table">
                <colgroup>
                  <col className="w-10" />
                  <col />
                  <col className="w-24" />
                  <col className="w-28" />
                  <col className="w-24" />
                  <col className="w-28" />
                  <col className="w-48" />
                </colgroup>
                <thead className="text-left">
                  <tr className="[&>th]:sticky [&>th]:top-14 [&>th]:z-10">
                    <th rowSpan={2} className="border-b border-line bg-subtle px-2 py-2 text-right text-xs font-medium text-ink-faint">#</th>
                    <th rowSpan={2} className="border-b border-line bg-subtle px-3 py-2 font-semibold text-ink">Order line</th>
                    <th colSpan={2} className="border-l border-line bg-red-50 px-3 pt-2 text-red-800">
                      <span className="block truncate font-semibold">− Old</span>
                    </th>
                    <th colSpan={2} className="border-l border-line bg-emerald-50 px-3 pt-2 text-emerald-800">
                      <span className="block truncate font-semibold">+ New</span>
                    </th>
                    <th rowSpan={2} className="border-b border-l border-line bg-subtle px-3 py-2 font-semibold text-ink">Change</th>
                  </tr>
                  <tr className="[&>th]:sticky [&>th]:top-[5.25rem] [&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:pb-2 [&>th]:text-xs [&>th]:font-medium">
                    <th className="border-l bg-red-50 text-red-700/80">Qty</th>
                    <th className="bg-red-50 text-red-700/80">Ship date</th>
                    <th className="border-l bg-emerald-50 text-emerald-700/80">Qty</th>
                    <th className="bg-emerald-50 text-emerald-700/80">Ship date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((line, i) => {
                    const s = sides(line);
                    return (
                      <tr key={`${line.po_number}|${line.po_line_number}|${line.part_number}|${line.ship_date}|${line.direction}`}
                          className="align-top [&>td]:border-b [&>td]:border-line-soft">
                        <td className="px-2 py-2.5 text-right text-xs text-ink-faint tabular">{data.meta.from + i}</td>
                        <td className="px-3 py-2"><LineInfo line={line} uploadId={linkTo} /></td>
                        {(["old", "new"] as const).map((side) => s[side].missing ? (
                          <td key={side} colSpan={2} className={`border-l border-l-line px-3 py-2.5 text-xs italic text-ink-faint ${hatch}`}>
                            {side === "old" ? "Not in the old file" : "Not in the new file"}
                          </td>
                        ) : [
                          <td key={`${side}-qty`} className={`border-l border-l-line px-3 py-2.5 ${SIDE[side].cell}`}>
                            <Value side={side} changed={s.qtyChanged}>{s[side].qty}</Value>
                          </td>,
                          <td key={`${side}-date`} className={`px-3 py-2.5 ${SIDE[side].cell}`}>
                            <Value side={side} changed={s.dateMoved}>{s[side].date}</Value>
                          </td>,
                        ])}
                        <td className="border-l border-l-line px-3 py-2.5"><ChangeBadge line={line} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* On a phone: a card per line, old and new next to each other. */}
              <div className="md:hidden">
                {data.data.map((line) => {
                  const s = sides(line);
                  return (
                    <div key={`${line.po_number}|${line.po_line_number}|${line.part_number}|${line.ship_date}|${line.direction}`} className="border-b border-line px-4 py-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <LineInfo line={line} uploadId={linkTo} />
                        <ChangeBadge line={line} />
                      </div>
                      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line text-sm">
                        {(["old", "new"] as const).map((side) => (
                          <div key={side} className={`px-3 py-2 ${side === "new" ? "border-l border-line" : ""} ${s[side].missing ? hatch : SIDE[side].cell}`}>
                            <span className={`block text-xs font-semibold ${side === "old" ? "text-red-700" : "text-emerald-700"}`}>{side === "old" ? "− Old" : "+ New"}</span>
                            {s[side].missing ? (
                              <span className="text-xs italic text-ink-faint">Not in this file</span>
                            ) : (
                              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                <Value side={side} changed={s.qtyChanged}>{s[side].qty}</Value>
                                <Value side={side} changed={s.dateMoved}>{s[side].date}</Value>
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="lines" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// One version picker: a card with a red (old) or green (new) edge, the version and who uploaded it.
function VersionBox({ side, id, value, uploads, version, onChange }: {
  side: "old" | "new"; id: string; value: number | null; uploads: UploadChoice[]; version?: UploadChoice; onChange: (id: string) => void;
}) {
  const old = side === "old";
  return (
    <div className={`min-w-0 rounded-lg border border-line border-t-4 bg-surface px-4 py-3 shadow-card ${old ? "border-t-red-400" : "border-t-emerald-500"}`}>
      <label htmlFor={id} className={`mb-1.5 block text-sm font-semibold ${old ? "text-red-800" : "text-emerald-800"}`}>
        {old ? "− Old version" : "+ New version"}
      </label>
      <Select id={id} className="block w-full" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {uploads.map((u) => <option key={u.id} value={u.id}>{versionLabel(u)}</option>)}
      </Select>
      {version && (
        <p className="mt-1.5 truncate text-xs text-ink-muted" title={version.original_filename}>
          {version.original_filename}{version.uploaded_by ? ` · uploaded by ${version.uploaded_by}` : ""}
        </p>
      )}
    </div>
  );
}

function Chip({ active, tone = "border-neutral-300 bg-white text-ink", onClick, children }: {
  active: boolean; tone?: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition ${tone} ${
              active ? "ring-2 ring-accent ring-offset-1" : "opacity-80 hover:opacity-100"
            }`}>
      {children}
    </button>
  );
}
