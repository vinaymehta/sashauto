"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { NotificationInfo, Paginated, UploadDetail, ValidationError } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { ChangesTable } from "./changes-table";
import { AddressChangesTable } from "./address-changes-table";
import { RowsTable } from "./rows-table";
import { ArrowUpDownIcon, FileIcon, MapPinIcon } from "./icons";
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

  const changes = (upload.stats.increase_count ?? 0) + (upload.stats.decrease_count ?? 0) + (upload.stats.address_change_count ?? 0);
  const isFirst = upload.previous_version === null;
  const status = isFirst ? undefined : (
    <NotificationStatus uploadId={upload.id} notification={upload.notification} changes={changes} onChanged={onChanged} />
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
  const [tab, setTab] = useState<"changes" | "addresses" | "rows">(isFirst ? "rows" : "changes");

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
          ) : (
            <RowsTable uploadId={upload.id} />
          )}
        </section>
      </div>
    </>
  );
}

const NOTIFICATION_POLL_MS = { pending: 3000, failed: 15000 } as const;

// Shows the admin email's delivery status and keeps it current: delivery happens in the background
// a few seconds after the upload completes, so a queued/failed email is re-checked until it is sent.
function NotificationStatus({ uploadId, notification: initial, changes, onChanged }: {
  uploadId: number; notification: NotificationInfo | null; changes: number; onChanged?: () => void;
}) {
  const notify = useToast();
  const [notification, setNotification] = useState(initial);
  const [source, setSource] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (initial !== source) {
    setSource(initial);
    setNotification(initial);
  }

  const status = notification?.status;
  useEffect(() => {
    if (status !== "pending" && status !== "failed") return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ data: UploadDetail }>(`/api/uploads/${uploadId}`);
        const next = res.data.notification;
        if (!active || !next) return;
        if (next.status === "sent") notify(`Email sent to ${next.recipients.join(", ")}.`);
        setNotification(next);
      } catch {
        if (active) setNotification((n) => (n ? { ...n } : n)); // try again on the next tick
      }
    }, NOTIFICATION_POLL_MS[status]);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status, notification, uploadId, notify]);

  if (changes === 0 || !notification) {
    return <span className="text-sm text-ink-muted">No changes · no email sent</span>;
  }

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      await api.post(`/api/uploads/${uploadId}/retry_notification`);
      notify("Email delivery queued again.");
      setNotification((n) => (n ? { ...n, status: "pending" } : n));
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not retry.");
    } finally {
      setRetrying(false);
    }
  }

  const to = notification.recipients.join(", ") || "admin";

  return (
    <div className="flex animate-fade-in flex-wrap items-center justify-end gap-x-2.5 gap-y-1 text-sm">
      {notification.status === "sent" && <Badge tone="up">Email sent</Badge>}
      {notification.status === "pending" && (
        <span className="inline-flex items-center gap-2"><Spinner className="h-3.5 w-3.5" /><Badge tone="warn">Sending email</Badge></span>
      )}
      {notification.status === "failed" && <Badge tone="down">Email failed</Badge>}
      <span className="text-ink-muted">
        {notification.status === "sent"
          ? `to ${to} · ${formatDateTime(notification.sent_at)}`
          : notification.status === "failed"
            ? <span title={notification.last_error ?? undefined}>Attempt {notification.attempts} failed · retrying automatically</span>
            : `to ${to}…`}
      </span>
      {notification.status === "failed" && (
        <Button size="sm" onClick={retry} disabled={retrying}>
          {retrying ? "Retrying…" : "Retry now"}
        </Button>
      )}
      {error && <span className="w-full text-down">{error}</span>}
    </div>
  );
}
