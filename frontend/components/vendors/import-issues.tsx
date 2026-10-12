"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { ImportIssue, ImportRowData, PageMeta } from "@/lib/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { AlertIcon, PencilIcon, TrashIcon } from "../icons";
import { useToast } from "../toast";
import { useApi, useDebounced } from "../use-api";
import { useListQuery } from "../use-list-query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert, EmptyState } from "../ui/feedback";
import { Field, Input, Textarea } from "../ui/field";
import { ListToolbar } from "../ui/list-toolbar";
import { Panel } from "../ui/panel";
import { SearchInput } from "../ui/search-input";
import { Sheet } from "../ui/sheet";
import { TableSkeleton } from "../ui/skeleton";
import { Pagination, Table, Td, Th } from "../ui/table";

type Status = ImportIssue["status"];
type IssuesPage = { data: ImportIssue[]; meta: PageMeta & { open_count: number } };

const STATUS_LABEL: Record<Status, string> = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };

// Number of open import issues, for the tab badge on Products and Vendors.
export function useOpenImportIssues() {
  const { data, reload } = useApi<IssuesPage>("/api/import_issues", { status: "open", per_page: 10 });
  return { count: data?.meta.open_count ?? null, reload };
}

// Problems from vendor workbook imports (skipped rows and values that could not be read), shown as a tab on
// Products and Vendors. Admins can fix and add a row, dismiss an issue, or delete the part a row created.
export function ImportIssuesPanel({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const notify = useToast();
  const list = useListQuery({}, 25);
  const [status, setStatus] = useState<Status>("open");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<IssuesPage>("/api/import_issues", { status, q, page: list.page, per_page: list.perPage });

  const [fixing, setFixing] = useState<ImportIssue | null>(null);
  const [deleting, setDeleting] = useState<ImportIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const changed = () => { reload(); onChanged(); };

  async function dismiss(issue: ImportIssue) {
    try {
      await api.post(`/api/import_issues/${issue.id}/dismiss`);
      notify(`Issue on Excel row ${issue.excel_row} dismissed.`);
      changed();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not dismiss the issue.", "error");
    }
  }

  async function deletePart() {
    if (!deleting) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ removed: string[] }>(`/api/import_issues/${deleting.id}/delete_part`);
      notify(res.removed.length ? `Deleted ${res.removed.join(" and ")}.` : "Nothing left to delete; issue closed.");
      setDeleting(null);
      changed();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete the part.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel flush>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} ${STATUS_LABEL[status].toLowerCase()} issue${data.meta.total === 1 ? "" : "s"}` : ""}>
        <div role="radiogroup" aria-label="Status" className="inline-flex rounded-md border border-line bg-subtle p-0.5">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => { setStatus(s); list.resetPage(); }}
                    className={`rounded px-3 py-1 text-sm font-medium transition-colors ${status === s ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <SearchInput label="Search issues" placeholder="Search part, vendor, file or problem" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
      </ListToolbar>

      {error ? (
        <div className="p-4"><Alert title="Could not load import issues">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={6} columns={6} />
      ) : data && data.data.length === 0 ? (
        <EmptyState
          title={q ? "No issues match" : status === "open" ? "No open import issues" : `No ${STATUS_LABEL[status].toLowerCase()} issues`}
          description={q ? "Try a different search." : status === "open" ? "Problems from vendor file imports (skipped rows, unreadable values) appear here." : undefined}
        />
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table>
            <thead>
              <tr>
                <Th>Excel row</Th>
                <Th>Part Number</Th>
                <Th>Vendor</Th>
                <Th>Problem</Th>
                {status !== "open" && <Th>{STATUS_LABEL[status]}</Th>}
                {canEdit && status === "open" && <Th align="right">Action</Th>}
              </tr>
            </thead>
            <tbody>
              {data.data.map((issue) => (
                <tr key={issue.id}>
                  <Td className="tabular align-top">
                    <span className="block">{issue.excel_row}</span>
                    <span className="block max-w-44 truncate text-xs text-ink-muted" title={issue.filename}>{issue.filename}</span>
                    <span className="block text-xs text-ink-faint">{formatDateTime(issue.created_at)} · {issue.imported_by ?? "—"}</span>
                  </Td>
                  <Td className="align-top font-medium">{issue.part_number || <span className="text-ink-faint">—</span>}</Td>
                  <Td className="align-top">{issue.vendor_name || <span className="text-ink-faint">—</span>}</Td>
                  <Td className="whitespace-normal! align-top">
                    <span className="flex max-w-sm items-start gap-2">
                      <Badge tone={issue.kind === "skipped" ? "down" : "warn"}>{issue.kind === "skipped" ? "Skipped" : "Unreadable"}</Badge>
                      <span className="min-w-0 text-sm">{issue.message}</span>
                    </span>
                  </Td>
                  {status !== "open" && (
                    <Td className="align-top text-sm text-ink-muted">
                      {formatDateTime(issue.resolved_at)}
                      <span className="block text-xs">{issue.resolved_by ?? "—"}{issue.resolution ? ` · ${{ fixed: "fixed", deleted: "part deleted", reimported: "file imported again" }[issue.resolution]}` : ""}</span>
                    </Td>
                  )}
                  {canEdit && status === "open" && (
                    <Td align="right" className="align-top">
                      <span className="inline-flex items-center gap-1">
                        <Button size="sm" onClick={() => setFixing(issue)}><PencilIcon size={14} className="text-ink-muted" />Fix &amp; add</Button>
                        <Button size="sm" variant="ghost" onClick={() => dismiss(issue)}>Dismiss</Button>
                        {issue.has_part && (
                          <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setDeleting(issue); }}
                                  title="Delete the vendor part this row created" aria-label={`Delete part from row ${issue.excel_row}`}>
                            <TrashIcon size={14} />
                          </Button>
                        )}
                      </span>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="issues" />
        </div>
      ) : null}

      {fixing && <FixRowPanel issue={fixing} onClose={() => setFixing(null)} onFixed={() => { setFixing(null); changed(); }} />}
      {deleting && (
        <ConfirmDialog title={`Delete the part from Excel row ${deleting.excel_row}?`} busy={busy} error={actionError}
                       onConfirm={deletePart} onCancel={() => setDeleting(null)}>
          Removes {deleting.part_number} from {deleting.vendor_name ?? "the vendor"}&apos;s parts. The product itself is deleted
          too if this import created it and nothing else uses it.
        </ConfirmDialog>
      )}
    </Panel>
  );
}

const FIELDS: { key: keyof ImportRowData; label: string; required?: boolean; hint?: string; long?: boolean }[] = [
  { key: "part_number", label: "Part Number", required: true },
  { key: "vendor_name", label: "Vendor Name", required: true },
  { key: "sash_part", label: "SASH Part" },
  { key: "vendor_part", label: "Vendor Part" },
  { key: "description", label: "Description", long: true },
  { key: "moq", label: "MOQ", hint: "e.g. 200 (sets), \"2000 pcs\" or \"200 of 10 pcs\"." },
  { key: "weight_kg", label: "Per Pc Weight in Kg", hint: "A number, e.g. 0.35." },
  { key: "price", label: "Vendor Price", hint: "e.g. ₹ 4.25, $1.5, GBP 4.04, 25. Currencies: INR, USD, EUR, CNY, GBP." },
];

// Side panel with the Excel row: correct it and add it, as the import would have.
function FixRowPanel({ issue, onClose, onFixed }: { issue: ImportIssue; onClose: () => void; onFixed: () => void }) {
  const notify = useToast();
  const [row, setRow] = useState<ImportRowData>(issue.row_data);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      await api.post(`/api/import_issues/${issue.id}/resolve`, { row });
      notify(`${row.part_number} added for ${row.vendor_name}.`);
      onFixed();
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as Record<string, string[]> | undefined) : undefined;
      if (details) setErrors(Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v.join(" ")])));
      setError(err instanceof ApiError ? err.message : "Could not add the row.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Fix Excel row ${issue.excel_row}`}
      description={issue.filename}
      icon={<AlertIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save and add"}</Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4" noValidate>
        <Alert tone="warning" title="Problem">{issue.message}</Alert>
        {error && !Object.keys(errors).length && <Alert>{error}</Alert>}
        <div className="space-y-4 rounded-lg border border-line bg-white px-5 py-5 shadow-card">
          {FIELDS.map((f) => {
            const id = `fix-${f.key}`;
            const fieldError = errors[f.key];
            const value = row[f.key] ?? "";
            const onChange = (v: string) => setRow((r) => ({ ...r, [f.key]: v }));
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required} hint={f.hint} error={fieldError}>
                {f.long
                  ? <Textarea id={id} value={value} className="w-full" onChange={(e) => onChange(e.target.value)} />
                  : <Input id={id} value={value} invalid={!!fieldError || f.key === issue.field} className="w-full"
                           autoFocus={f.key === issue.field} onChange={(e) => onChange(e.target.value)} />}
              </Field>
            );
          })}
        </div>
        {errors.base && <Alert>{errors.base}</Alert>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
