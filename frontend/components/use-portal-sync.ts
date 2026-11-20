"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "./toast";
import { useApi } from "./use-api";

export interface SyncResult { business: string; status: "uploaded" | "same" | "failed"; upload_id?: number; file?: string; message?: string }
// The SMS OTP the sync waits for at Deere's OTP screen: "waiting" for a code, "submitted" once one was typed (being checked).
export interface SyncOtp { status: "waiting" | "submitted"; message: string; requested_at: string; expires_at?: string }
export interface SyncStatus {
  state: "never" | "queued" | "running" | "done" | "failed";
  running: boolean;
  trigger?: "manual" | "schedule";
  by?: string | null;
  requested_at?: string;
  started_at?: string;
  finished_at?: string;
  results?: SyncResult[];
  error?: string | null;
  otp?: SyncOtp | null;
  attention?: boolean; // a sync failed and none has succeeded since: the popup shows on each visit
}

export const RESULT_LABEL: Record<SyncResult["status"], string> = { uploaded: "Uploaded", same: "No change", failed: "Failed" };

const BUSY_POLL_MS = 5000;

// The Deere portal sync (the same job as the 08:00 IST schedule: download each business's file from the Deere portal
// and upload it): its current or last run, `run` to start it right away and `submitOtp` for the SMS code it waits for.
// While a run is queued, running or waiting for the code the status refreshes every few seconds; otherwise every
// `idleMs` (none: not at all).
export function usePortalSync({ idleMs }: { idleMs?: number } = {}) {
  const notify = useToast();
  const { data, error, reload } = useApi<{ data: SyncStatus }>("/api/portal_sync");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const status = data?.data;
  const busy = !!status && (status.running || status.state === "queued" || status.state === "running");
  const interval = busy || status?.otp ? BUSY_POLL_MS : idleMs;

  useEffect(() => {
    if (!interval) return;
    const timer = setInterval(reload, interval);
    return () => clearInterval(timer);
  }, [interval, reload]);

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

  // Sends the SMS code to the waiting sync; returns the error message, or null when it was sent.
  async function submitOtp(code: string): Promise<string | null> {
    try {
      await api.post("/api/portal_sync/otp", { code });
      notify("OTP sent. The sync goes on in a few seconds.");
      reload();
      return null;
    } catch (err) {
      reload();
      return err instanceof ApiError ? err.message : "Could not send the OTP.";
    }
  }

  return { status, error, busy, starting, startError, run, submitOtp, reload };
}
