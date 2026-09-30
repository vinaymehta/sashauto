"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ChevronDownIcon, LogoutIcon } from "./icons";
import { useSession } from "./session";
import { useDismiss } from "./use-dismiss";

const ROLE_LABEL = { admin: "Admin", warehouse_manager: "Warehouse Manager" } as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

export function UserMenu() {
  const { user, signOut } = useSession();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  if (!user) return null;

  async function onSignOut() {
    setSigningOut(true);
    await signOut().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-9 items-center gap-2 rounded-md pl-1 pr-2 transition-colors hover:bg-white/10 ${open ? "bg-white/10" : ""}`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-2xs font-semibold text-neutral-900">
          {initials(user.name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-4 text-white">{user.name}</span>
          <span className="block text-2xs leading-4 text-neutral-400">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDownIcon size={14} className={`text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-64 origin-top-right animate-pop-in overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-base font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-1.5"><span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-2xs font-medium text-ink-muted">{ROLE_LABEL[user.role]}</span></p>
          </div>
          <button role="menuitem" onClick={onSignOut} disabled={signingOut}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-base text-ink transition-colors hover:bg-canvas disabled:text-ink-faint">
            <LogoutIcon size={16} className="text-ink-muted" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
