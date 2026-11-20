"use client";

import { formatDateTime } from "@/lib/format";
import { Button } from "../ui/button";
import { RefreshIcon } from "../icons";
import { RESULT_LABEL as RESULT, usePortalSync } from "../use-portal-sync";

// Top bar of the main Admin Settings page: "Sync now" and a one-line status of the current or last run (each business's
// result in its tooltip).
export function PortalSyncButton() {
  const { status, busy, starting, run } = usePortalSync();
  const failed = status?.state === "failed" || (status?.results ?? []).some((r) => r.status === "failed");
  const line = !status ? "" : busy ? "Sync running…"
    : status.state === "never" ? "Not synced yet"
      : `Last sync ${formatDateTime(status.finished_at)}${failed ? " · failed" : ""}`;
  const details = !status || busy || status.state === "never" ? "Downloads the DTP and GMBH files from the Deere portal and uploads them. Runs by itself at 08:00 IST."
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

