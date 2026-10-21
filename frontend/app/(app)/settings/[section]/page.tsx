"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/components/session";
import { SettingsNav, SettingsTopBar } from "@/components/settings/settings-chrome";
import { SettingsForm } from "@/components/settings/settings-form";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";
import { Alert } from "@/components/ui/feedback";

// The settings window of one page: the top bar (back to Admin Settings, search), the list of every settings page on
// the left and the page's form on the right.
export default function SettingsSectionPage() {
  const admin = useSession().user?.role === "admin";
  const { section: slug } = useParams<{ section: string }>();
  const section = SETTINGS_SECTIONS.find((s) => s.slug === slug);
  if (!admin) return <Alert title="Admins only">Only an admin can change the settings.</Alert>;
  if (!section?.group) {
    return <Alert title="Settings page not found"><Link href="/settings" className="font-medium underline">Back to Admin Settings</Link></Alert>;
  }

  return (
    <div className="-mx-4 -my-5 flex min-h-screen flex-col bg-gradient-to-br from-tint-violet/50 via-neutral-50 to-tint-aqua/40 sm:-mx-6">
      <SettingsTopBar back />
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-line bg-white/60 px-3 py-4 backdrop-blur md:w-64 md:shrink-0 md:border-b-0 md:border-r">
          <SettingsNav current={section} />
        </aside>
        {/* The form card starts next to the list, keeps a readable width and is only as tall as its fields. */}
        <div className="min-w-0 flex-1 md:p-6">
          <div className="max-w-5xl overflow-hidden bg-white md:rounded-xl md:border md:border-line md:shadow-card">
            <SettingsForm key={section.slug} group={section.group} title={section.title} description={section.description} category={section.category} />
          </div>
        </div>
      </div>
    </div>
  );
}
