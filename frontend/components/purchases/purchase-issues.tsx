"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatCount, formatDate, formatDateTime, formatQty } from "@/lib/format";
import type { PageMeta, Paginated, PurchaseIssue, Vendor } from "@/lib/types";
import { PlusIcon, TruckIcon } from "../icons";
import { useToast } from "../toast";
import { useApi, useDebounced } from "../use-api";
import { useListQuery } from "../use-list-query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert, EmptyState } from "../ui/feedback";
import { ListToolbar } from "../ui/list-toolbar";
import { Panel } from "../ui/panel";
import { SearchInput } from "../ui/search-input";
import { Sheet } from "../ui/sheet";
import { TableSkeleton } from "../ui/skeleton";
import { Pagination, Table, Td, Th } from "../ui/table";

type Status = PurchaseIssue["status"];
type IssuesPage = { data: PurchaseIssue[]; meta: PageMeta & { counts: Record<Status, number> } };
const STATUS_LABEL: Record<Status, string> = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };
const KIND_LABEL: Record<PurchaseIssue["reason_kind"], string> = {
  vendor: "Vendor not found", order: "No PO / order", recorded: "Already in", forecast: "Forecast", qty: "No Qty", received: "Over PO Qty", other: "Other",
};
const RESOLUTION: Record<string, string> = { linked: "vendor chosen", vendor_created: "vendor added", recorded: "recorded as received" };
const dash = <span className="text-ink-faint">—</span>;

// Purchase orders → Import issues, as on Products and Vendors: the rows of uploaded vendor PO lists and Purchase
// Received files that were not recorded. Open / Resolved / Dismissed; a row whose vendor was not found can be given a
// vendor (Choose vendor, or Add as vendor with the file's name) and is then recorded; any can be dismissed, a dismissed
// one reopened.
export function PurchaseIssuesPanel({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const notify = useToast();
  const list = useListQuery({}, 100);
  const [status, setStatus] = useState<Status>("open");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<IssuesPage>("/api/purchase_issues", { status, q, page: list.page, per_page: list.perPage });
  const [choosing, setChoosing] = useState<PurchaseIssue | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const changed = () => { reload(); onChanged(); };

  async function act(issue: PurchaseIssue, path: string, done: string, body?: object) {
    setWorking(issue.id);
    try {
      await api.post(`/api/purchase_issues/${issue.id}/${path}`, body);
      notify(done);
      changed();
      return true;
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "That did not work.", "error");
      return false;
    } finally {
      setWorking(null);
    }
  }

  return (
    <Panel flush>
      <ListToolbar summary={data ? `${formatCount(data.meta.total)} ${STATUS_LABEL[status].toLowerCase()} issue${data.meta.total === 1 ? "" : "s"}` : ""}>
        <div role="radiogroup" aria-label="Status" className="inline-flex rounded-md border border-line bg-subtle p-0.5">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => { setStatus(s); list.resetPage(); }}
                    className={`rounded px-3 py-1 text-sm font-medium transition-colors ${status === s ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
              {STATUS_LABEL[s]}{data ? <span className="ml-1 text-xs text-ink-faint">{formatCount(data.meta.counts[s])}</span> : null}
            </button>
          ))}
        </div>
        <SearchInput label="Search issues" placeholder="Search part, vendor, PO, invoice or problem" value={search}
                     onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
      </ListToolbar>
      {error ? (
        <div className="p-4"><Alert title="Could not load the import issues">{error.message}</Alert></div>
      ) : loading && !data ? (
        <TableSkeleton rows={6} columns={6} />
      ) : data && data.data.length === 0 ? (
        <EmptyState title={q ? "No issues match" : status === "open" ? "No open import issues" : `No ${STATUS_LABEL[status].toLowerCase()} issues`}
                    description={q ? "Try a different search." : status === "open" ? "Rows of uploaded vendor PO lists and Purchase Received files that could not be recorded appear here." : undefined} />
      ) : data ? (
        <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
          <Table fixed minWidth="min-w-[1000px]">
            <colgroup>
              <col className="w-52" /><col className="w-32" /><col className="w-48" /><col className="w-36" /><col /><col className="w-64" />
            </colgroup>
            <thead>
              <tr><Th>Excel row</Th><Th>Part</Th><Th>Vendor</Th><Th>Type</Th><Th>Problem</Th><Th align="right">{status === "open" ? "Action" : STATUS_LABEL[status]}</Th></tr>
            </thead>
            <tbody>
              {data.data.map((issue) => (
                <tr key={issue.id} className="text-sm leading-5 hover:bg-neutral-50">
                  <Td className="py-3 align-top">
                    <span className="block font-semibold text-ink">Row {issue.excel_row ?? "—"}</span>
                    <span className="block truncate text-xs text-ink-muted" title={issue.filename}>{issue.kind === "received" ? "Purchase received" : "Vendor PO list"} · {issue.filename}</span>
                    <span className="block text-xs text-ink-faint">{formatDateTime(issue.uploaded_at)} · {issue.uploaded_by ?? "—"}</span>
                  </Td>
                  <Td className="py-3 align-top">
                    <span className="block font-medium">{issue.part_number || dash}</span>
                    {issue.po_number && <span className="block text-xs text-ink-muted">PO {issue.po_number}</span>}
                  </Td>
                  <Td className="py-3 align-top">
                    <span className="block truncate font-medium" title={issue.vendor ?? undefined}>{issue.vendor || dash}</span>
                    <span className="block truncate text-xs text-ink-muted" title={issue.reference ?? undefined}>
                      {issue.reference ? `${issue.kind === "received" ? "Invoice" : "PO"} ${issue.reference}` : ""}{issue.qty ? ` · ${formatQty(issue.qty)} pcs` : ""}
                      {issue.date ? ` · ${formatDate(issue.date)}` : ""}
                    </span>
                  </Td>
                  <Td className="py-3 align-top"><Badge tone={issue.reason_kind === "vendor" ? "warn" : "down"}>{KIND_LABEL[issue.reason_kind]}</Badge></Td>
                  <Td className="whitespace-normal! break-words py-3 align-top text-ink">{issue.reason}</Td>
                  <Td align="right" className="py-3 align-top">
                    {issue.status === "open" ? (canEdit && (
                      <span className="inline-flex flex-wrap justify-end gap-1.5">
                        {issue.reason_kind === "vendor" && (<>
                          <Button size="sm" onClick={() => setChoosing(issue)} disabled={working === issue.id}><TruckIcon size={14} className="text-ink-muted" />Choose vendor</Button>
                          <Button size="sm" onClick={() => act(issue, "create_vendor", `"${issue.vendor}" added as a vendor and the row recorded.`)} disabled={working === issue.id}
                                  title="Add this name as a new vendor and record the row">
                            <PlusIcon size={14} className="text-ink-muted" />Add as vendor
                          </Button>
                        </>)}
                        <Button size="sm" variant="ghost" onClick={() => act(issue, "dismiss", `Issue on row ${issue.excel_row} dismissed.`)} disabled={working === issue.id}>Dismiss</Button>
                      </span>
                    )) : (
                      <span className="inline-flex flex-col items-end gap-1 text-ink-muted">
                        <span>{formatDateTime(issue.resolved_at)}</span>
                        <span className="text-xs">{issue.resolved_by ?? "—"}{issue.resolution ? ` · ${RESOLUTION[issue.resolution] ?? issue.resolution}` : ""}</span>
                        {issue.status === "dismissed" && canEdit && (
                          <Button size="sm" onClick={() => act(issue, "reopen", `Issue on row ${issue.excel_row} reopened.`)} disabled={working === issue.id}>Reopen</Button>
                        )}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="issues" />
        </div>
      ) : null}
      {choosing && (
        <ChooseVendor issue={choosing} onClose={() => setChoosing(null)}
                      onChoose={async (vendor) => {
                        if (await act(choosing, "link_vendor", `Row ${choosing.excel_row} recorded with ${vendor.name}.`, { vendor_id: vendor.id })) setChoosing(null);
                      }} />
      )}
    </Panel>
  );
}

// Choose vendor: search Vendors and pick the one the file means.
function ChooseVendor({ issue, onClose, onChoose }: { issue: PurchaseIssue; onClose: () => void; onChoose: (vendor: Vendor) => void }) {
  const first = (issue.vendor ?? "").split(/[\s,.(]+/).find((w) => w.length > 2) ?? "";
  const [search, setSearch] = useState(first);
  const q = useDebounced(search.trim());
  const { data, loading } = useApi<Paginated<Vendor>>(q ? "/api/vendors" : null, { q, per_page: 25 });
  return (
    <Sheet open onClose={onClose} title="Choose vendor" icon={<TruckIcon size={18} />}
           description={<>The file says <b>{issue.vendor}</b> (row {issue.excel_row}). Pick the vendor it means: the row is then recorded with it.</>}>
      <SearchInput label="Search vendors" placeholder="Search vendor name" value={search} onSearch={setSearch} className="mb-3 w-full" />
      {!q ? <p className="text-sm text-ink-muted">Type part of the vendor name.</p>
        : loading && !data ? <p className="text-sm text-ink-muted">Searching…</p>
        : data && data.data.length === 0 ? <p className="text-sm text-ink-muted">No vendor matches. Use Add as vendor instead.</p>
        : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {data?.data.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{v.name}{v.code ? <span className="ml-2 text-xs text-ink-muted">{v.code}</span> : null}</span>
                <Button size="sm" onClick={() => onChoose(v)}>Choose</Button>
              </li>
            ))}
          </ul>
        )}
    </Sheet>
  );
}

// Open issues, for the tab count.
export function useOpenPurchaseIssues() {
  const { data, reload } = useApi<IssuesPage>("/api/purchase_issues", { status: "open", per_page: 1 });
  return { count: data?.meta.counts.open ?? null, reload };
}
