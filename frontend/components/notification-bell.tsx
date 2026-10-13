"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ActivityFeed, ActivityKind } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { AlertIcon, BellIcon, BoxIcon, CheckIcon, FileIcon, TruckIcon } from "./icons";
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
  delivered: { icon: TruckIcon, className: "bg-inc text-white" },
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

  function toggle() {
    setOpen(!open);
  }

  // Notifications stay unread until "Mark as read" is clicked.
  function markRead() {
    if (!feed || feed.unread_count === 0) return;
    setFeed({ ...feed, unread_count: 0, items: feed.items.map((item) => ({ ...item, unread: false })) });
    api.post("/api/activity/read").catch(() => undefined);
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
        <BellIcon size={21} />
        {unread > 0 && (
          <span className="absolute right-1 -top-0.5 flex animate-pop-in h-3.5 min-w-3.5 items-center justify-center rounded-full bg-white px-0.5 text-[9px] font-semibold leading-none text-neutral-900 ring-[1.5px] ring-nav">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-[min(24rem,calc(100vw-2rem))] origin-top-right animate-pop-in overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-base font-semibold text-ink">Notifications</p>
            <button onClick={markRead} disabled={unread === 0}
                    className="text-xs text-ink-muted hover:text-ink disabled:cursor-default disabled:text-ink-faint">
              Mark as read
            </button>
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
                        className={`relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                          item.unread ? "bg-accent/5 hover:bg-accent/10" : "hover:bg-canvas"}`}
                      >
                        {/* Unread: blue bar on the left and a dot; read items are plain. */}
                        {item.unread && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${className}`}>
                          <Icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm text-ink ${item.unread ? "font-semibold" : "font-normal"}`}>{item.title}</span>
                          <span className="block truncate text-xs text-ink-muted">{item.description}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className={`text-2xs ${item.unread ? "font-medium text-accent" : "text-ink-faint"}`}>{formatRelative(item.at)}</span>
                          {item.unread && <span aria-label="Unread" className="h-2 w-2 rounded-full bg-accent" />}
                        </span>
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
