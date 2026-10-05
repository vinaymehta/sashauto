"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ActivityFeed, ActivityKind } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { AlertIcon, BellIcon, BoxIcon, CheckIcon, FileIcon } from "./icons";
import { Spinner } from "./ui/feedback";
import { useDismiss } from "./use-dismiss";

export const ACTIVITY_CHANGED_EVENT = "activity-changed";
const POLL_MS = 60_000;

const KIND_STYLE: Record<ActivityKind, { icon: typeof BellIcon; className: string }> = {
  changes: { icon: FileIcon, className: "bg-accent text-white" },
  no_changes: { icon: CheckIcon, className: "bg-subtle text-ink-muted" },
  baseline: { icon: FileIcon, className: "bg-subtle text-ink-muted" },
  upload_failed: { icon: AlertIcon, className: "bg-white text-neutral-900 ring-1 ring-neutral-900" },
  email_failed: { icon: AlertIcon, className: "bg-white text-neutral-900 ring-1 ring-neutral-900" },
  conflicts: { icon: BoxIcon, className: "bg-white text-neutral-900 ring-1 ring-neutral-300" },
};

export function NotificationBell() {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<ActivityFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const load = useCallback(async () => {
    try {
      setFeed(await api.get<ActivityFeed>("/api/activity"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Initial load, periodic refresh, and immediate refresh when an upload finishes.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, POLL_MS);
    window.addEventListener(ACTIVITY_CHANGED_EVENT, load);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener(ACTIVITY_CHANGED_EVENT, load);
    };
  }, [load]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && feed && feed.unread_count > 0) {
      setFeed({ ...feed, unread_count: 0 });
      api.post("/api/activity/read").catch(() => undefined);
    }
  }

  const unread = feed?.unread_count ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className={`relative flex h-9 w-9 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-white/10 hover:text-white ${open ? "bg-white/10 text-white" : ""}`}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex animate-pop-in h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-semibold leading-none text-neutral-900 ring-2 ring-nav">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-[min(24rem,calc(100vw-2rem))] origin-top-right animate-pop-in overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-base font-semibold text-ink">Notifications</p>
            <button onClick={load} className="text-xs text-ink-muted hover:text-ink">Refresh</button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {!feed && !failed ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : failed && !feed ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">Could not load notifications.</p>
            ) : feed && feed.items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-base font-medium text-ink">You&apos;re all caught up</p>
                <p className="mt-1 text-sm text-ink-muted">Upload results and alerts will appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {feed!.items.map((item) => {
                  const { icon: Icon, className } = KIND_STYLE[item.kind];
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => { close(); router.push(item.href); }}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas"
                      >
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${className}`}>
                          <Icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{item.title}</span>
                          <span className="block truncate text-xs text-ink-muted">{item.description}</span>
                        </span>
                        <span className="shrink-0 text-2xs text-ink-faint">{formatRelative(item.at)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <button onClick={() => { close(); router.push("/orders"); }} className="text-sm text-ink-muted hover:text-ink">
              View uploads →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
