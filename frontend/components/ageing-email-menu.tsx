"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ChevronDownIcon } from "./icons";
import { useToast } from "./toast";
import { Button } from "./ui/button";
import { useDismiss } from "./use-dismiss";

interface AgeingResult {
  data: { status: "queued" | "baseline" | "empty" | "no_data"; mode: "manual" | "preview"; counts: Record<string, number>; recipients: string[] };
}

const bands = (c: Record<string, number>) => `30+ days: ${c["30"] ?? 0} · 60+ days: ${c["60"] ?? 0} · 90+ days: ${c["90"] ?? 0}`;

// Sends the order ageing email on demand. The same email also goes out automatically every day at 09:00.
export function AgeingEmailMenu() {
  const notify = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  async function send(mode: "manual" | "preview") {
    setOpen(false);
    setBusy(true);
    try {
      const { data } = await api.post<AgeingResult>("/api/ageing_digests", { mode });
      const to = data.recipients.join(", ");
      if (data.status === "queued") {
        notify(mode === "preview" ? `Test ageing email sent to ${to} (${bands(data.counts)}).` : `Ageing email sent to ${to} (${bands(data.counts)}).`);
      } else if (data.status === "baseline") {
        notify("First run: rows already past 30/60/90 days were recorded without an email. From now on only rows that newly reach a threshold are emailed.");
      } else if (data.status === "empty") {
        notify(mode === "preview" ? "No order rows are 30 or more days past their ship date." : "No order rows newly reached 30, 60 or 90 days, so no email was sent.");
      } else {
        notify("There is no order data yet.", "error");
      }
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not send the ageing email.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen((o) => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
        {busy ? "Sending…" : "Ageing email"}
        <ChevronDownIcon size={14} className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-80 origin-top-right animate-pop-in overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <button role="menuitem" type="button" onClick={() => send("manual")} className="block w-full px-4 py-3 text-left transition-colors hover:bg-neutral-50">
            <span className="block text-sm font-medium text-ink">Send now</span>
            <span className="block text-xs text-ink-muted">Rows that newly reached 30, 60 or 90 days. Same as the daily 09:00 email.</span>
          </button>
          <button role="menuitem" type="button" onClick={() => send("preview")} className="block w-full border-t border-line px-4 py-3 text-left transition-colors hover:bg-neutral-50">
            <span className="block text-sm font-medium text-ink">Send test preview</span>
            <span className="block text-xs text-ink-muted">All rows currently in each band. Nothing is marked as notified.</span>
          </button>
        </div>
      )}
    </div>
  );
}
