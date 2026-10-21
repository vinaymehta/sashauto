"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useToast } from "../toast";
import { useApi } from "../use-api";
import { Button } from "../ui/button";
import { RefreshIcon } from "../icons";

interface SyncResult { business: string; status: "uploaded" | "same" | "failed"; upload_id?: number; file?: string; message?: string }
interface SyncStatus {
  state: "never" | "queued" | "running" | "done" | "failed";
  running: boolean;
  trigger?: "manual" | "schedule";
  by?: string | null;
  requested_at?: string;
  started_at?: string;
  finished_at?: string;
  results?: SyncResult[];
  error?: string | null;
}

const POLL_MS = 5000;

// The portal sync (the same job as the 08:00 / 20:00 IST schedule: download each business's file from the Deere portal
// and upload it): its current or last run, and `run` to start it right away. While a run is queued or running the
// status refreshes every few seconds.
function usePortalSync() {
  const notify = useToast();
  const { data, error, reload } = useApi<{ data: SyncStatus }>("/api/portal_sync");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const status = data?.data;
  const busy = !!status && (status.running || status.state === "queued" || status.state === "running");

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, reload]);

  async function run() {
    setStarting(true);
    setStartError(null);
    try {
      await api.post("/api/portal_sync", {});
      notify("Sync started. The files are downloaded from the Deere portal and uploaded.");
      reload();
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : "Could not start the sync.");
      notify(err instanceof ApiError ? err.message : "Could not start the sync.");
    } finally {
      setStarting(false);
    }
  }

  return { status, error, busy, starting, startError, run };
}

// Top bar of the main Admin Settings page: "Sync now" and a one-line status of the current or last run (each business's
// result in its tooltip).
export function PortalSyncButton() {
  const { status, busy, starting, run } = usePortalSync();
  const failed = status?.state === "failed" || (status?.results ?? []).some((r) => r.status === "failed");
  const line = !status ? "" : busy ? "Sync running…"
    : status.state === "never" ? "Not synced yet"
      : `Last sync ${formatDateTime(status.finished_at)}${failed ? " · failed" : ""}`;
  const details = !status || busy || status.state === "never" ? "Downloads the DTP and GMBH files from the Deere portal and uploads them. Runs by itself at 08:00 and 20:00 IST."
    : [status.error, ...(status.results ?? []).map((r) => `${r.business.toUpperCase()}: ${RESULT[r.status]}${r.status === "uploaded" ? ` (upload #${r.upload_id})` : r.message ? ` (${r.message})` : ""}`)]
      .filter(Boolean).join("\n");
  return (
    <div className="flex items-center justify-end gap-3">
      {line && <span title={details} className={`hidden cursor-default truncate text-xs xl:block ${failed && !busy ? "text-dec" : "text-ink-muted"}`}>{line}</span>}
      <Button variant="primary" onClick={run} disabled={busy || starting} title={details}>
        <RefreshIcon size={15} className={busy ? "animate-spin" : ""} />
        {busy ? "Syncing…" : starting ? "Starting…" : "Sync now"}
      </Button>
    </div>
  );
}

const RESULT: Record<SyncResult["status"], string> = { uploaded: "Uploaded", same: "No change", failed: "Failed" };
