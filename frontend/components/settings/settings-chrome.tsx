"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AppSettingItem } from "@/lib/types";
import { BellIcon, BoxIcon, ChevronDownIcon, ChevronLeftIcon, FileIcon, KeyIcon, SearchIcon, SettingsIcon } from "../icons";
import { TINTS, type Tint } from "../ui/tint";
import { useApi } from "../use-api";
import { useDismiss } from "../use-dismiss";
import { PortalSyncButton } from "./portal-sync";
import { SETTINGS_CATEGORIES, SETTINGS_SECTIONS, sectionHref, type SettingsSection } from "./sections";

// Each category's colour: its icon chip and wash (TINTS), a strong `line` (card top, current page) and a soft `soft`
// (current page background, hover).
// `top` / `left`: a coloured top or left border only (the other sides keep their own colour).
export const CATEGORY_STYLE: Record<string, { icon: typeof BoxIcon; tint: Tint; top: string; left: string; soft: string; text: string }> = {
  Organization: { icon: BoxIcon, tint: "violet", top: "border-t-tint-violet-ink", left: "border-l-tint-violet-ink", soft: "bg-tint-violet", text: "text-tint-violet-ink" },
  Documents: { icon: FileIcon, tint: "amber", top: "border-t-tint-amber-ink", left: "border-l-tint-amber-ink", soft: "bg-tint-amber", text: "text-tint-amber-ink" },
  Notifications: { icon: BellIcon, tint: "aqua", top: "border-t-tint-aqua-ink", left: "border-l-tint-aqua-ink", soft: "bg-tint-aqua", text: "text-tint-aqua-ink" },
  Integrations: { icon: KeyIcon, tint: "dec", top: "border-t-dec", left: "border-l-dec", soft: "bg-dec-bg", text: "text-dec" },
};

// The company name shown under "Admin Settings" (the saved setting, else .env).
function useCompanyName() {
  const { data } = useApi<{ data: AppSettingItem[] }>("/api/settings");
  const company = data?.data.find((i) => i.key === "COMPANY_NAME");
  return company?.value || company?.env_value || "SASH";
}

// Top bar of the settings window: (on a settings page) a back button to Admin Settings, the title with the company,
// a search over every settings page and field ("/" focuses it), and (on the main page) "Sync now" for the Deere portal.
export function SettingsTopBar({ back = false }: { back?: boolean }) {
  const company = useCompanyName();
  return (
    <div className="flex flex-col gap-3 border-b border-line bg-gradient-to-r from-tint-violet via-white to-tint-aqua/60 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
      <div className="flex shrink-0 items-center gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm"><SettingsIcon size={18} /></span>
        {back && (
          <Link href="/settings" aria-label="Back to Admin Settings" title="Admin Settings"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-white text-ink-muted hover:bg-neutral-50 hover:text-ink">
            <ChevronLeftIcon size={16} />
          </Link>
        )}
        <div className="min-w-0 shrink-0">
          <p className="whitespace-nowrap text-lg font-semibold leading-tight text-ink">Admin Settings</p>
          <p className="truncate text-xs text-ink-muted">{company}</p>
        </div>
      </div>
      <div className="min-w-0 sm:mx-auto sm:w-full sm:max-w-md"><SettingsSearch /></div>
      {/* "Sync now" on the main Admin Settings page only (not on the pages inside it). */}
      {back ? <div className="hidden w-48 xl:block" /> : <div className="shrink-0"><PortalSyncButton /></div>}
    </div>
  );
}

// Search box with a results list: settings pages (title, description) and single fields (label, hint).
function SettingsSearch() {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ data: AppSettingItem[] }>("/api/settings");
  useDismiss(box, open, () => setOpen(false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== "/" || target.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const term = query.trim().toLowerCase();
  const pages = term ? SETTINGS_SECTIONS.filter((s) => `${s.title} ${s.description} ${s.category}`.toLowerCase().includes(term)) : [];
  const fields = term ? (data?.data ?? []).filter((f) => `${f.label} ${f.hint ?? ""}`.toLowerCase().includes(term)).slice(0, 8) : [];
  const sectionOf = (group: string) => SETTINGS_SECTIONS.find((s) => s.group === group);
  const go = (href: string) => { setOpen(false); setQuery(""); router.push(href); };

  return (
    <div ref={box} className="relative">
      <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input ref={input} type="search" value={query} placeholder="Search settings ( / )" aria-label="Search settings"
             onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
             className="h-10 w-full rounded-lg border border-line bg-neutral-50 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-tint-violet-ink/60 focus:bg-white focus:outline-none focus:ring-4 focus:ring-tint-violet-ink/10" />
      {open && term && (
        <div className="absolute left-0 right-0 top-12 z-40 max-h-96 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-pop">
          {pages.length === 0 && fields.length === 0 && <p className="px-4 py-3 text-sm text-ink-muted">No settings match.</p>}
          {pages.map((s) => (
            <button key={s.slug} type="button" onClick={() => go(sectionHref(s))} className="block w-full px-4 py-2 text-left hover:bg-neutral-50">
              <span className="block text-sm font-medium text-ink">{s.title}</span>
              <span className="block truncate text-xs text-ink-muted">{s.category} · {s.description}</span>
            </button>
          ))}
          {fields.map((f) => {
            const section = sectionOf(f.group);
            return section ? (
              <button key={f.key} type="button" onClick={() => go(`${sectionHref(section)}#${f.key}`)} className="block w-full px-4 py-2 text-left hover:bg-neutral-50">
                <span className="block text-sm text-ink">{f.label}</span>
                <span className="block truncate text-xs text-ink-muted">{section.category} › {section.title}</span>
              </button>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

// Left list of the settings window: each category opens and closes (the current one starts open), with its pages;
// the current page is highlighted.
export function SettingsNav({ current }: { current: SettingsSection }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([current.category]));
  const toggle = (c: string) => setOpen((o) => { const n = new Set(o); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  return (
    <nav aria-label="Settings" className="space-y-0.5">
      <p className="px-3 pb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">Settings</p>
      {SETTINGS_CATEGORIES.map((category) => {
        const style = CATEGORY_STYLE[category]!;
        const Icon = style.icon;
        return (
          <div key={category}>
            <button type="button" onClick={() => toggle(category)} aria-expanded={open.has(category)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-white/80 ${current.category === category ? "text-ink" : "text-ink-muted"}`}>
              <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${TINTS[style.tint].chip}`}><Icon size={13} /></span>
              <span className="flex-1">{category}</span>
              <ChevronDownIcon size={14} className={`shrink-0 text-ink-faint transition-transform ${open.has(category) ? "" : "-rotate-90"}`} />
            </button>
            {open.has(category) && (
              <div className="mb-1 ml-5 space-y-0.5 border-l border-line pl-3">
                {SETTINGS_SECTIONS.filter((s) => s.category === category).map((s) => (
                  <Link key={s.slug} href={sectionHref(s)} aria-current={s.slug === current.slug ? "page" : undefined}
                        className={`block rounded-md border-l-[3px] px-3 py-2 text-sm transition-colors ${s.slug === current.slug
                          ? `${style.left} ${style.soft} font-semibold ${style.text}` : "border-transparent text-ink-muted hover:bg-white hover:text-ink"}`}>
                    {s.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
