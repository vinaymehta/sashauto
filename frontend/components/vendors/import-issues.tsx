"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { ImportIssue, ImportRowData, PageMeta, Paginated, Vendor } from "@/lib/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { AlertIcon, PencilIcon, PlusIcon, TrashIcon, TruckIcon } from "../icons";
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
// Products and Vendors. Admins can fix and add a row, dismiss an issue, or delete the part a row created. Rows of the
// vendor details / tax officer file that were not saved are linked to an existing vendor ("Same as…") or added as a
// new vendor.
export function ImportIssuesPanel({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const notify = useToast();
  const list = useListQuery({}, 25);
  const [status, setStatus] = useState<Status>("open");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<IssuesPage>("/api/import_issues", { status, q, page: list.page, per_page: list.perPage });

  const [fixing, setFixing] = useState<ImportIssue | null>(null);
  const [linking, setLinking] = useState<ImportIssue | null>(null);
  const [viewing, setViewing] = useState<ImportIssue | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<ImportIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const changed = () => { reload(); onChanged(); };
  // Vendor issues have no part number: the column is shown only when a row on the page has one.
  const showPart = data?.data.some((i) => i.part_number) ?? true;

  // Returns whether it worked (the panel then closes).
  async function dismiss(issue: ImportIssue) {
    setDismissing(issue.id);
    try {
      await api.post(`/api/import_issues/${issue.id}/dismiss`);
      notify(`Issue on Excel row ${issue.excel_row} dismissed.`);
      changed();
      return true;
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not dismiss the issue.", "error");
      return false;
    } finally {
      setDismissing(null);
    }
  }

  // A vendor details row that is a vendor not in the app yet: add it with the row's details. Returns whether it worked.
  async function addVendor(issue: ImportIssue) {
    setAdding(issue.id);
    try {
      const res = await api.post<{ vendor: Vendor }>(`/api/import_issues/${issue.id}/create_vendor`);
      notify(`Vendor ${res.vendor.name} added.`);
      changed();
      return true;
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not add the vendor.", "error");
      return false;
    } finally {
      setAdding(null);
    }
  }

  // The actions on an open issue, at the bottom of its panel (RowDataPanel). Same as… / Fix & add / delete close the
  // panel and open the vendor picker, the fix form or the delete confirmation in its place; Add as vendor and Dismiss
  // keep it open while they run and close it once done (it stays open on an error).
  const actionButtons = (issue: ImportIssue) => {
    const run = (action: () => void) => () => { setViewing(null); action(); };
    const thenClose = (action: () => Promise<boolean>) => async () => { if (await action()) setViewing(null); };
    const working = adding === issue.id || dismissing === issue.id;
    return issue.kind === "vendor_details" ? (
      <>
        <Button size="sm" onClick={run(() => setLinking(issue))} disabled={working} title="It is a vendor already in the app: put these details on it">
          <TruckIcon size={14} className="text-ink-muted" />Same as…
        </Button>
        {issue.source === "details" && (
          <Button size="sm" onClick={thenClose(() => addVendor(issue))} disabled={working} title="Add it as a new vendor">
            <PlusIcon size={14} className="text-ink-muted" />{adding === issue.id ? "Adding…" : "Add as vendor"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={thenClose(() => dismiss(issue))} disabled={working}>{dismissing === issue.id ? "Dismissing…" : "Dismiss"}</Button>
      </>
    ) : (
      <>
        <Button size="sm" onClick={run(() => setFixing(issue))}><PencilIcon size={14} className="text-ink-muted" />Fix &amp; add</Button>
        <Button size="sm" variant="ghost" onClick={thenClose(() => dismiss(issue))} disabled={working}>{dismissing === issue.id ? "Dismissing…" : "Dismiss"}</Button>
        {issue.has_part && (
          <Button size="sm" variant="ghost" onClick={run(() => { setActionError(null); setDeleting(issue); })}
                  title="Delete the vendor part this row created" aria-label={`Delete part from row ${issue.excel_row}`}>
            <TrashIcon size={14} />
          </Button>
        )}
      </>
    );
  };

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
          description={q ? "Try a different search." : status === "open" ? "Problems from vendor file imports (skipped rows, unreadable values, vendors not matched) appear here." : undefined}
        />
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table fixed minWidth="min-w-[960px]">
            <colgroup>
              <col className="w-60" />
              {showPart && <col className="w-40" />}
              <col className="w-72" />
              <col className="w-28" />
              <col />
              {status !== "open" && <col className="w-52" />}
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr>
                <Th>Excel row</Th>
                {showPart && <Th>Part Number</Th>}
                <Th>Vendor</Th>
                <Th>Type</Th>
                <Th>Problem</Th>
                {status !== "open" && <Th>{STATUS_LABEL[status]}</Th>}
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {/* Every cell starts with one 20px text line, so the rows line up across the columns. */}
              {data.data.map((issue) => (
                <tr key={issue.id} onClick={() => setViewing(issue)} aria-haspopup="dialog"
                    className="cursor-pointer text-sm leading-5 transition-colors hover:bg-neutral-50">
                  <Td className="py-3 align-top">
                    <span className="block font-semibold text-ink">Row {issue.excel_row}</span>
                    <span className="block truncate text-xs text-ink-muted" title={issue.filename}>{issue.filename}</span>
                    <span className="block text-xs text-ink-faint">{formatDateTime(issue.created_at)} · {issue.imported_by ?? "—"}</span>
                  </Td>
                  {showPart && <Td className="py-3 align-top font-medium">{issue.part_number || <span className="text-ink-faint">—</span>}</Td>}
                  <Td className="py-3 align-top">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-ink" title={issue.vendor_name ?? undefined}>
                        {issue.vendor_name || <span className="text-ink-faint">—</span>}
                      </span>
                      {issue.vendor_code && (
                        <span className="shrink-0 rounded border border-line bg-subtle px-1.5 text-xs font-semibold leading-5 text-ink-muted">{issue.vendor_code}</span>
                      )}
                    </span>
                  </Td>
                  <Td className="py-3 align-top">
                    <Badge tone={issue.kind === "skipped" ? "down" : "warn"}>
                      {issue.kind === "skipped" ? "Skipped" : issue.kind === "vendor_details" ? "Vendor" : "Unreadable"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-normal! py-3 align-top text-ink">{issue.message}</Td>
                  {status !== "open" && (
                    <Td className="py-3 align-top text-ink-muted">
                      <span className="block">{formatDateTime(issue.resolved_at)}</span>
                      <span className="block text-xs">{issue.resolved_by ?? "—"}{issue.resolution ? ` · ${{ fixed: "fixed", deleted: "part deleted", reimported: "file imported again", linked: "linked to a vendor", created: "added as a vendor" }[issue.resolution]}` : ""}</span>
                    </Td>
                  )}
                  {/* One icon: opens the issue's panel (the data from the file, and the actions on an open issue). */}
                  <Td align="right" className="py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => setViewing(issue)} aria-label={`Edit the issue on Excel row ${issue.excel_row}`}
                            title={canEdit && issue.status === "open" ? "Edit: data from the file and actions" : "Data from the file"}
                            className="-my-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink">
                      <PencilIcon size={16} />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="issues" />
        </div>
      ) : null}

      {fixing && <FixRowPanel issue={fixing} onClose={() => setFixing(null)} onFixed={() => { setFixing(null); changed(); }} />}
      {viewing && (
        <RowDataPanel issue={viewing} onClose={() => setViewing(null)}
                      actions={canEdit && viewing.status === "open" ? actionButtons(viewing) : undefined} />
      )}
      {linking && <LinkVendorPanel issue={linking} onClose={() => setLinking(null)} onLinked={() => { setLinking(null); changed(); }} />}
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

// Side panel for a vendor details row: choose the vendor it really is (suggested look-alikes first, or search all);
// the row's details (Vendor Code, contact, GSTIN, …, or the tax officer address) go onto that vendor.
function LinkVendorPanel({ issue, onClose, onLinked }: { issue: ImportIssue; onClose: () => void; onLinked: () => void }) {
  const notify = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, loading } = useApi<Paginated<Vendor>>(q ? "/api/vendors" : null, { q, per_page: 25 });
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function link(vendor: { id: number; name: string }) {
    setSaving(vendor.id);
    setError(null);
    try {
      await api.post(`/api/import_issues/${issue.id}/link_vendor`, { vendor_id: vendor.id });
      notify(`${issue.vendor_name} details saved on ${vendor.name}.`);
      onLinked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the details.");
      setSaving(null);
    }
  }

  const option = (v: { id: number; name: string; code: string | null }) => (
    <li key={v.id}>
      <button type="button" onClick={() => link(v)} disabled={saving !== null}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-subtle disabled:opacity-50">
        <span className="font-medium text-ink">{v.name}{v.code && <span className="ml-2 text-xs font-semibold text-ink-muted">{v.code}</span>}</span>
        <span className="text-xs text-ink-muted">{saving === v.id ? "Saving…" : "Same as this"}</span>
      </button>
    </li>
  );

  return (
    <Sheet open onClose={onClose} title={`Same as… · ${issue.vendor_name ?? ""}`} description={`Excel row ${issue.excel_row} · ${issue.filename}`}
           icon={<TruckIcon size={18} />}>
      <div className="space-y-4">
        <Alert tone="warning" title="Problem">{issue.message}</Alert>
        {error && <Alert>{error}</Alert>}
        {issue.candidates.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
            <h3 className="border-b border-neutral-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">Suggested</h3>
            <ul className="divide-y divide-neutral-100">{issue.candidates.map(option)}</ul>
          </section>
        )}
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <div className="border-b border-neutral-100 p-3">
            <Input aria-label="Search vendors" placeholder="Search another vendor" value={search} className="w-full" autoFocus={!issue.candidates.length}
                   onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!q ? (
            <p className="px-4 py-3 text-sm text-ink-muted">Type a vendor name or code.</p>
          ) : loading && !data ? (
            <p className="px-4 py-3 text-sm text-ink-muted">Searching…</p>
          ) : data && data.data.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-muted">No vendor matches.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">{data?.data.map(option)}</ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}

const GST_TREATMENT_LABEL: Record<string, string> = {
  registered_regular: "Registered Business - Regular", registered_composition: "Registered Business - Composition",
  unregistered: "Unregistered Business", consumer: "Consumer", overseas: "Overseas", sez: "Special Economic Zone",
  deemed_export: "Deemed Export",
};

// Labels of the vendor details stored with a vendor row (Vendors::DetailsImporter), in display order.
const VENDOR_FIELDS: [string, string][] = [
  ["code", "Vendor Code"], ["company_name", "Vendor Name"], ["address", "Address"], ["salutation", "Salutation"],
  ["first_name", "Contact (first name)"], ["last_name", "Contact (last name)"], ["phone", "Contact No"], ["email", "Email ID"],
  ["gst", "GSTIN"], ["pan", "PAN"], ["place_of_supply", "Place of Supply"], ["gst_treatment", "GST Treatment"],
  ["gst_rate", "GST Rate (%)"], ["lead_days", "Lead Days"], ["payment_terms", "Payment Terms"],
  ["tax_officer_address", "Jurisdictional Tax Officer"],
];

// Side panel with everything the file had on the issue's row (read-only).
// `actions`: the issue's action buttons, in the footer.
function RowDataPanel({ issue, onClose, actions }: { issue: ImportIssue; onClose: () => void; actions?: React.ReactNode }) {
  const data = issue.row_data as Record<string, unknown>;
  const attributes = (data.attributes ?? {}) as Record<string, unknown>;
  const rows: [string, unknown][] = issue.kind === "vendor_details"
    ? [["Vendor Name (file)", data.vendor_name], ["Vendor Code (file)", data.vendor_code],
       ...VENDOR_FIELDS.filter(([key]) => key in attributes && key !== "code" && key !== "company_name").map(([key, label]) => [label, attributes[key]] as [string, unknown])]
    : FIELDS.map((f) => [f.label, data[f.key]] as [string, unknown]);
  const text = (value: unknown, label?: string) => {
    if (value === null || value === undefined || value === "") return null;
    if (label === "GST Treatment") return GST_TREATMENT_LABEL[String(value)] ?? String(value);
    if (label === "GST Rate (%)") return `${value}%`;
    return String(value);
  };

  return (
    <Sheet open onClose={onClose} title={`Excel row ${issue.excel_row}`} description={issue.filename} icon={<AlertIcon size={18} />}
           footer={actions && <span className="flex flex-wrap justify-end gap-2">{actions}</span>}>
      <div className="space-y-4">
        <Alert tone="warning" title="Problem">{issue.message}</Alert>
        {issue.kind === "vendor_details" && issue.candidates.length > 0 && (
          <p className="rounded-lg border border-line bg-white px-5 py-3 text-sm text-ink shadow-card">
            <span className="text-ink-muted">Possibly the same as </span>
            {issue.candidates.map((c, i) => (
              <span key={c.id}>{i > 0 && ", "}<b>{c.name}</b>{c.code && <span className="text-ink-muted"> ({c.code})</span>}</span>
            ))}
            <span className="text-ink-muted">. Use Same as… if it is; Add as vendor if it is a different company.</span>
          </p>
        )}
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <h3 className="border-b border-neutral-100 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Data from the file</h3>
          <dl className="divide-y divide-neutral-100">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 px-5 py-2.5 text-sm sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="whitespace-pre-line break-words text-ink">{text(value, label) ?? <span className="text-ink-faint">—</span>}</dd>
              </div>
            ))}
          </dl>
        </section>
        <p className="text-xs text-ink-muted">
          Imported {formatDateTime(issue.created_at)} by {issue.imported_by ?? "—"}.
        </p>
      </div>
    </Sheet>
  );
}
