"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { EmailInfo, EmailKind, Paginated, UploadDetail, ValidationError } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { ChangesTable } from "./changes-table";
import { AddressChangesTable } from "./address-changes-table";
import { MoqAlertsTable } from "./moq-alerts-table";
import { RowsTable } from "./rows-table";
import { AlertIcon, ArrowUpDownIcon, FileIcon, MapPinIcon } from "./icons";
import { Tabs } from "./ui/tabs";
import { useApi } from "./use-api";
import { useListQuery } from "./use-list-query";
import { FilterChips, FilterMenu, type FilterGroup } from "./ui/filter-menu";
import { TableSkeleton } from "./ui/skeleton";
import { useToast } from "./toast";
import { VersionKpis } from "./upload-summary";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Alert, Spinner } from "./ui/feedback";
import { Panel } from "./ui/panel";
import { Pagination, Table, Td, Th } from "./ui/table";

export function UploadResult({ upload, onChanged }: { upload: UploadDetail; onChanged?: () => void }) {
  if (upload.status === "pending" || upload.status === "processing") {
    return (
      <Panel>
        <div className="flex items-center gap-3 text-ink">
          <Spinner />
          {upload.status === "pending" ? "Queued for processing…" : "Validating and comparing the workbook…"}
        </div>
      </Panel>
    );
  }

  if (upload.status === "failed") return <FailedUpload upload={upload} />;

  const isFirst = upload.previous_version === null;
  // A first upload has no comparison, but can still send MOQ alert and ageing emails.
  const status = isFirst && upload.emails.length === 0 ? undefined : (
    <EmailStatus uploadId={upload.id} emails={upload.emails} onChanged={onChanged} />
  );

  return <VersionData upload={upload} status={status} />;
}

// Key the API uses for problems that are not tied to one column (duplicate rows, empty file).
const NO_COLUMN = "_none";

function FailedUpload({ upload }: { upload: UploadDetail }) {
  const list = useListQuery();
  const filters: FilterGroup[] = [{
    key: "column",
    label: "Column",
    options: Object.entries(upload.problem_columns).map(([column, count]) => ({
      value: column, label: `${column === NO_COLUMN ? "Duplicate rows / file" : column} (${count})`,
    })),
  }];
  const { data, error, loading } = useApi<Paginated<ValidationError>>(
    upload.problem_count > 0 ? `/api/uploads/${upload.id}/problems` : null,
    { page: list.page, per_page: list.perPage, column: list.filters.column },
  );

  return (
    <div className="space-y-4">
      <Alert title="The upload was rejected. Nothing was imported.">
        {upload.error_message}
      </Alert>
      {upload.problem_count > 0 && (
        <Panel
          title="Problems to fix"
          description={`Correct these in the workbook and upload it again.${upload.problem_count >= 500 ? " The first 500 problems are listed." : ""}`}
          actions={filters[0]!.options.length > 1
            ? <FilterMenu groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
            : undefined}
          flush
        >
          <FilterChips groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
          {error ? (
            <div className="p-4"><Alert title="Could not load the problems">{error.message}</Alert></div>
          ) : !data ? (
            <TableSkeleton rows={6} columns={3} />
          ) : (
            <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
              <Table>
                <thead>
                  <tr>
                    <Th>Excel row</Th>
                    <Th>Column</Th>
                    <Th>Problem</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((e, i) => (
                    <tr key={`${data.meta.from}-${i}`}>
                      <Td className="tabular align-top">{e.rows.length ? e.rows.join(", ") : "—"}</Td>
                      <Td className="align-top text-ink-muted">{e.column ?? "—"}</Td>
                      <Td className="whitespace-normal">{e.message}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="problems" />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function VersionData({ upload, status }: { upload: UploadDetail; status?: ReactNode }) {
  const isFirst = upload.previous_version === null;
  const changes = (upload.stats.increase_count ?? 0) + (upload.stats.decrease_count ?? 0);
  const moqAlerts = upload.stats.moq_alert_count ?? 0;
  const [tab, setTab] = useState<"changes" | "addresses" | "moq" | "rows">(isFirst ? (moqAlerts > 0 ? "moq" : "rows") : "changes");

  return (
    <>
      {/* ── KPI cards ── */}
      <VersionKpis upload={upload} />

      {/* ── Tabs + full-width data table ── */}
      <div className="mt-6">
        <div className="flex items-center border-b border-line">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              ...(isFirst ? [] : [
                { key: "changes" as const, label: "Quantity changes", icon: <ArrowUpDownIcon size={14} />, count: changes },
                { key: "addresses" as const, label: "Address changes", icon: <MapPinIcon size={14} />, count: upload.stats.address_change_count ?? 0 },
              ]),
              ...(isFirst && moqAlerts === 0 ? [] : [
                { key: "moq" as const, label: "MOQ alerts", icon: <AlertIcon size={14} />, count: moqAlerts },
              ]),
              { key: "rows" as const, label: "Uploaded rows", icon: <FileIcon size={14} />, count: upload.stats.row_count },
            ]}
          />
          {status && <div className="ml-auto pb-1.5 pl-4">{status}</div>}
        </div>
        <section key={tab} className="animate-fade-in overflow-hidden rounded-lg border border-line bg-surface shadow-card border-t-0">
          {tab === "changes" ? (
            <ChangesTable
              uploadId={upload.id}
              emptyDescription="Every order row present in both the previous and the latest upload has the same quantity."
            />
          ) : tab === "addresses" ? (
            <AddressChangesTable uploadId={upload.id} />
          ) : tab === "moq" ? (
            <MoqAlertsTable uploadId={upload.id} />
          ) : (
            <RowsTable uploadId={upload.id} />
          )}
        </section>
      </div>
    </>
  );
}

const EMAIL_POLL_MS = { pending: 3000, failed: 15000 } as const;
const EMAIL_LABELS: Record<EmailKind, string> = {
  quantity_changes: "Quantity", address_changes: "Address", moq_alerts: "MOQ", ageing: "Ageing",
};

// Shows the delivery status of each email sent for this upload (one per kind: quantity changes, address
// changes, MOQ alerts, ageing) and keeps it current: delivery happens in the background a few seconds
// after the upload completes, so queued/failed emails are re-checked until they are sent.
export function EmailStatus({ uploadId, emails: initial, onChanged }: {
  uploadId: number; emails: EmailInfo[]; onChanged?: () => void;
}) {
  const notify = useToast();
  const [emails, setEmails] = useState(initial);
  const [source, setSource] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (initial !== source) {
    setSource(initial);
    setEmails(initial);
  }

  const waiting = emails.some((e) => e.status === "pending") ? "pending" : emails.some((e) => e.status === "failed") ? "failed" : null;
  useEffect(() => {
    if (!waiting) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ data: UploadDetail }>(`/api/uploads/${uploadId}`);
        if (!active) return;
        const next = res.data.emails;
        const newlySent = next.filter((e) => e.status === "sent" && emails.find((o) => o.kind === e.kind)?.status !== "sent");
        if (newlySent.length > 0) {
          notify(`${newlySent.map((e) => EMAIL_LABELS[e.kind]).join(", ")} email${newlySent.length === 1 ? "" : "s"} sent to ${newlySent[0]!.recipients.join(", ")}.`);
        }
        setEmails(next);
      } catch {
        if (active) setEmails((list) => [...list]); // try again on the next tick
      }
    }, EMAIL_POLL_MS[waiting]);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [waiting, emails, uploadId, notify]);

  if (emails.length === 0) {
    return <span className="text-sm text-ink-muted">No changes · no email sent</span>;
  }

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const res = await api.post<{ data: EmailInfo[] }>(`/api/uploads/${uploadId}/retry_notification`);
      notify("Email delivery queued again.");
      setEmails(res.data.map((e) => (e.status === "failed" ? { ...e, status: "pending" } : e)));
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not retry.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex animate-fade-in flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
      {emails.map((e) => {
        const to = e.recipients.join(", ") || "admin";
        const title = e.status === "sent"
          ? `${e.subject}\nSent to ${to} · ${formatDateTime(e.sent_at)}`
          : e.status === "failed"
            ? `${e.subject}\nAttempt ${e.attempts} failed · retrying automatically${e.last_error ? `\n${e.last_error}` : ""}`
            : `${e.subject}\nSending to ${to}…`;
        return (
          <span key={`${e.kind}-${e.id}`} title={title} className="inline-flex items-center gap-1.5">
            <span className="text-ink-muted">{EMAIL_LABELS[e.kind]}</span>
            {e.status === "sent" && <Badge tone="up">Sent</Badge>}
            {e.status === "pending" && <><Spinner className="h-3.5 w-3.5" /><Badge tone="warn">Sending</Badge></>}
            {e.status === "failed" && <Badge tone="down">Failed</Badge>}
          </span>
        );
      })}
      {emails.some((e) => e.status === "failed") && (
        <Button size="sm" onClick={retry} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry now"}
        </Button>
      )}
      {error && <span className="w-full text-right text-down">{error}</span>}
    </div>
  );
}
