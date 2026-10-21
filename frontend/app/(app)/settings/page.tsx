"use client";

import Link from "next/link";
import { useSession } from "@/components/session";
import { CATEGORY_STYLE, SettingsTopBar } from "@/components/settings/settings-chrome";
import { SETTINGS_CATEGORIES, SETTINGS_SECTIONS, sectionHref } from "@/components/settings/sections";
import { TINTS } from "@/components/ui/tint";
import { Alert } from "@/components/ui/feedback";

// Admin Settings: every settings page in cards by category; a page opens the settings window (/settings/[section]).
export default function SettingsPage() {
  const admin = useSession().user?.role === "admin";
  if (!admin) return <Alert title="Admins only">Only an admin can change the settings.</Alert>;

  return (
    <div className="-mx-4 -my-5 min-h-[calc(100vh-3.5rem)] bg-neutral-50 sm:-mx-6">
      <SettingsTopBar />
      <div className="px-4 py-6 sm:px-6 lg:px-10">
        <section className="rounded-xl border border-line bg-white p-5 shadow-card sm:p-7">
          <h1 className="mb-5 text-lg font-semibold text-ink">Admin Settings</h1>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SETTINGS_CATEGORIES.map((category) => {
              const style = CATEGORY_STYLE[category]!;
              const Icon = style.icon;
              return (
                <div key={category} className="overflow-hidden rounded-lg border border-line bg-white">
                  <p className={`flex items-center gap-2 bg-gradient-to-r ${TINTS[style.tint].wash} to-white px-4 py-3 font-semibold text-ink`}>
                    <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-md ${TINTS[style.tint].chip}`}><Icon size={15} /></span>
                    {category}
                  </p>
                  <ul className="px-2 pb-3 pt-1">
                    {SETTINGS_SECTIONS.filter((s) => s.category === category).map((s) => (
                      <li key={s.slug}>
                        <Link href={sectionHref(s)} title={s.description}
                              className="block rounded-md px-2 py-2 text-sm text-ink transition-colors hover:bg-neutral-50 hover:text-accent">
                          {s.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
