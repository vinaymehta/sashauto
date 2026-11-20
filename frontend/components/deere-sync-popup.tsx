"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "@/lib/format";
import { AlertIcon, CloseIcon, RefreshIcon } from "./icons";
import { Button } from "./ui/button";
import { Spinner } from "./ui/feedback";
import { RESULT_LABEL, usePortalSync, type SyncOtp, type SyncStatus } from "./use-portal-sync";

// Opens the popup from anywhere (the bell's Deere sync items).
export const OPEN_DEERE_SYNC_EVENT = "open-deere-sync";
// While a failed sync needs attention: shown once per visit (browser tab session), remembered here.
const SEEN_KEY = "deere-sync-seen";
// Checks every 30 s in the background whether the sync failed or started waiting for an OTP.
const IDLE_POLL_MS = 30_000;

const BUSINESS: Record<string, string> = { dtp: "DTP", gmbh: "GMBH" };

// The John Deere sync popup, for the people who look after the sync (admins and users ticked for the Deere sync alerts):
// the current or last run with each business's result and "Sync again". When a sync fails it opens on each of their
// visits until a sync succeeds (`attention`); also from the bell's Deere sync items and the alert email's link
// (?deere_sync=1). When the sync waits for the SMS OTP it opens by itself with the OTP box and the time left. A rejected
// or late OTP fails the run: Sync again asks Deere for a new code.
export function DeereSyncPopup() {
  const { status, busy, starting, run, submitOtp } = usePortalSync({ idleMs: IDLE_POLL_MS });
  const [open, setOpen] = useState(false);
  // The OTP request the user closed the popup on: it does not open again for that one.
  const [dismissedOtp, setDismissedOtp] = useState<string | null>(null);

  // The alert email's or Slack's link (?deere_sync=1) and the bell open it. The link is cleaned only once it really
  // opens: an effect run that is undone at once must not lose it.
  useEffect(() => {
    const fromLink = new URL(window.location.href).searchParams.has("deere_sync");
    const first = fromLink ? setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("deere_sync");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      setOpen(true);
    }, 0) : undefined;
    const show = () => setOpen(true);
    window.addEventListener(OPEN_DEERE_SYNC_EVENT, show);
    return () => {
      clearTimeout(first);
      window.removeEventListener(OPEN_DEERE_SYNC_EVENT, show);
    };
  }, []);

  // A failed sync not followed by a successful one: opens once per visit. Once a sync succeeds the visit is forgotten,
  // so a later failure opens it again.
  const loaded = !!status;
  const attention = status?.attention === true;
  useEffect(() => {
    if (!loaded) return;
    if (!attention) {
      try { sessionStorage.removeItem(SEEN_KEY); } catch { /* storage blocked */ }
      return;
    }
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === "1"; } catch { /* storage blocked: open on every page load */ }
    if (seen) return;
    const timer = setTimeout(() => {
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
      setOpen(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [loaded, attention]);

  const otp = status?.otp ?? null;
  // A new OTP request opens the popup, and it stays open (after Submit too) until the user closes it.
  const newOtp = otp?.status === "waiting" && otp.requested_at !== dismissedOtp;
  if (newOtp && !open) setOpen(true);

  const otpAt = otp?.requested_at ?? null;
  const close = useCallback(() => {
    setOpen(false);
    setDismissedOtp(otpAt);
  }, [otpAt]);
  // Escape closes it wherever the focus is (caught first, so a side panel underneath stays open).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open || !status) return null;

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-neutral-950/30 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="deere-sync-title"
           className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-white shadow-2xl">
        <header className="flex items-start gap-3.5 border-b border-line px-6 py-5">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-tint-violet text-tint-violet-ink">
            <RefreshIcon size={18} className={busy ? "animate-spin" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="deere-sync-title" className="text-lg font-semibold text-ink">John Deere sync</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Downloads the DTP and GMBH order files from the Deere portal and uploads them. Runs by itself at 08:00 IST.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-ink-muted hover:bg-neutral-100 hover:text-ink">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {otp && <OtpBox key={otp.requested_at} otp={otp} onSubmit={submitOtp} />}
          {attention && !busy && !otp && (
            <p className="flex items-start gap-2 rounded-lg border border-dec bg-dec-bg px-4 py-3 text-sm text-ink">
              <AlertIcon size={16} className="mt-0.5 shrink-0 text-dec" />
              <span>The last sync failed. Click <b>Sync again</b> to run it now. If Deere asks for the SMS code, the box appears here.</span>
            </p>
          )}
          <RunStatus status={status} busy={busy} onOpenUpload={close} />
        </div>

        <footer className="flex justify-end gap-2 border-t border-line bg-neutral-50 px-6 py-3">
          <Button variant="ghost" onClick={close}>Close</Button>
          <Button variant="primary" onClick={run} disabled={busy || starting}>
            <RefreshIcon size={15} className={busy ? "animate-spin" : ""} />
            {busy ? "Syncing…" : starting ? "Starting…" : "Sync again"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// The SMS OTP the sync waits for: the code box and the time left, or "checking" once a code was sent.
function OtpBox({ otp, onSubmit }: { otp: SyncOtp; onSubmit: (code: string) => Promise<string | null> }) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = useSecondsLeft(otp.status === "waiting" ? otp.expires_at : undefined);

  if (otp.status === "submitted") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-lg border border-line bg-neutral-50 px-4 py-3 text-sm text-ink">
        <Spinner /> Code sent. Checking it with Deere…
      </div>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return setError("Enter the code from the SMS.");
    setSending(true);
    setError(await onSubmit(code.trim()));
    setSending(false);
  }

  return (
    <form onSubmit={send} className="rounded-lg border border-warn bg-warn-bg px-4 py-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink"><AlertIcon size={16} /> Deere is asking for the SMS OTP</p>
      <p className="mt-1 text-sm text-ink-soft">{otp.message}</p>
      <div className="mt-3 flex gap-2">
        <input value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} autoFocus inputMode="numeric" autoComplete="one-time-code"
               maxLength={20} placeholder="SMS code" aria-label="SMS code"
               className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-white px-3 text-base tracking-widest text-ink outline-none focus:border-accent" />
        <Button type="submit" variant="primary" disabled={sending || left === 0}>{sending ? "Sending…" : "Submit OTP"}</Button>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-dec">{error}</p>}
      {left !== null && (
        <p className={`mt-2 text-xs ${left <= 60 ? "font-medium text-dec" : "text-ink-muted"}`}>
          {left > 0 ? `The sync waits ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} more for the code.` : "Time is up: the sync stops. Click Sync again to get a new code."}
        </p>
      )}
    </form>
  );
}

// Seconds until `until` (ticking every second), or null without it.
function useSecondsLeft(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.round((new Date(until).getTime() - now) / 1000)) : null;
}

const STATE: Record<SyncStatus["state"], { label: string; className: string }> = {
  never: { label: "Not synced yet", className: "bg-subtle text-ink-muted" },
  queued: { label: "Starting", className: "bg-status-busy-bg text-status-busy" },
  running: { label: "Running", className: "bg-status-busy-bg text-status-busy" },
  done: { label: "Done", className: "bg-status-ok-bg text-status-ok" },
  failed: { label: "Failed", className: "bg-status-fail-bg text-status-fail" },
};

// The current or last run: state, when and by whom, and each business's result.
function RunStatus({ status, busy, onOpenUpload }: { status: SyncStatus; busy: boolean; onOpenUpload: () => void }) {
  const state = STATE[busy && status.state !== "queued" ? "running" : status.state];
  const who = status.trigger === "schedule" ? "Scheduled run (08:00 IST)" : status.by ? `Started by ${status.by}` : null;
  return (
    <section className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="text-sm font-semibold text-ink">{busy ? "Current sync" : "Last sync"}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${state.className}`}>
          {busy && <Spinner className="h-3 w-3" />}{state.label}
        </span>
      </div>
      {status.state === "never" ? (
        <p className="px-4 py-3 text-sm text-ink-muted">The sync has not run yet. Click Sync again to run it now.</p>
      ) : (
        <div className="space-y-3 px-4 py-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {who && <><dt className="text-ink-muted">Run</dt><dd className="text-ink">{who}</dd></>}
            {(status.started_at || status.requested_at) && <><dt className="text-ink-muted">Started</dt><dd className="text-ink">{formatDateTime(status.started_at ?? status.requested_at)}</dd></>}
            {status.finished_at && !busy && <><dt className="text-ink-muted">Finished</dt><dd className="text-ink">{formatDateTime(status.finished_at)}</dd></>}
          </dl>
          {!busy && (status.results ?? []).length > 0 && (
            <ul className="divide-y divide-line-soft rounded-md border border-line-soft">
              {status.results!.map((r) => (
                <li key={r.business} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="font-medium text-ink">{BUSINESS[r.business] ?? r.business.toUpperCase()}</span>
                  <span className="min-w-0 text-right">
                    <span className={r.status === "failed" ? "font-medium text-dec" : r.status === "uploaded" ? "font-medium text-inc" : "text-ink-muted"}>{RESULT_LABEL[r.status]}</span>
                    {r.status === "uploaded" && r.upload_id && (
                      <Link href={`/uploads/${r.upload_id}`} onClick={onOpenUpload} className="ml-2 text-accent underline-offset-2 hover:underline">Open upload</Link>
                    )}
                    {r.status === "same" && <span className="block text-xs text-ink-muted">Same file as the last upload</span>}
                    {r.message && <span className="block text-xs text-ink-muted">{r.message}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!busy && status.error && <p className="rounded-md bg-dec-bg px-3 py-2 text-sm text-dec">{status.error}</p>}
        </div>
      )}
    </section>
  );
}
