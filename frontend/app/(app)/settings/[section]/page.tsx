"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/components/session";
import { SettingsNav, SettingsTopBar } from "@/components/settings/settings-chrome";
import { SettingsForm } from "@/components/settings/settings-form";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";
import { Alert } from "@/components/ui/feedback";

// The settings window of one page: the top bar (back to All Settings, search), the list of every settings page on
// the left and the page's form on the right.
export default function SettingsSectionPage() {
  const admin = useSession().user?.role === "admin";
  const { section: slug } = useParams<{ section: string }>();
  const section = SETTINGS_SECTIONS.find((s) => s.slug === slug);
  if (!admin) return <Alert title="Admins only">Only an admin can change the settings.</Alert>;
  if (!section?.group) {
    return <Alert title="Settings page not found"><Link href="/settings" className="font-medium underline">Back to All Settings</Link></Alert>;
  }

  return (
    <div className="-mx-4 -my-5 flex min-h-screen flex-col bg-neutral-50 sm:-mx-6">
      <SettingsTopBar back />
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-line bg-white px-3 py-4 md:w-64 md:shrink-0 md:border-b-0 md:border-r">
          <SettingsNav current={section} />
        </aside>
        <div className="min-w-0 flex-1 bg-white md:m-4 md:rounded-lg md:border md:border-line md:shadow-card">
          <SettingsForm key={section.slug} group={section.group} title={section.title} description={section.description} />
        </div>
      </div>
    </div>
  );
}
