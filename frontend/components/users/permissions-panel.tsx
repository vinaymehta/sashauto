"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { SECTIONS, type Level, type Section } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { KeyIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Sheet } from "../ui/sheet";
import { ROLE_LABEL } from "./user-form-panel";

// Users → a user: each section of the app enabled (see and change it: "edit") or disabled (the page is hidden:
// "none"). Admins always have everything enabled. The server enforces the same rules.
export function PermissionsPanel({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const notify = useToast();
  const admin = user.role === "admin";
  const enabledAt = (level: Level) => level !== "none";
  const [enabled, setEnabled] = useState<Record<Section, boolean>>(
    () => Object.fromEntries(SECTIONS.map((s) => [s.key, enabledAt(user.permissions[s.key])])) as Record<Section, boolean>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = SECTIONS.some((s) => enabled[s.key] !== enabledAt(user.permissions[s.key]));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch<{ data: User }>(`/api/users/${user.id}`, {
        // Enabled = see and change (edit), disabled = hidden (none).
        permissions: Object.fromEntries(SECTIONS.map((s) => [s.key, enabled[s.key] ? "edit" : "none"])),
      });
      notify(`Permissions of ${user.name} saved.`);
      onSaved(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the permissions.");
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={user.name} icon={<KeyIcon size={18} />}
           description={<>{ROLE_LABEL[user.role]} · {user.email}</>}
           footer={admin ? <Button onClick={onClose}>Close</Button> : <>
             <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
             <Button variant="primary" onClick={save} disabled={!changed || saving}>{saving ? "Saving…" : "Save permissions"}</Button>
           </>}>
      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <header className="border-b border-neutral-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Permissions</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {admin ? "Admins can see and change everything, and manage users." : "Enable a part of the app to let this user see and change it; disabled parts are hidden. Users is for admins only."}
          </p>
        </header>
        {error && <div className="px-5 pt-3"><Alert>{error}</Alert></div>}
        <ul className="divide-y divide-neutral-100">
          {SECTIONS.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{s.label}</span>
                <span className="block text-xs text-ink-muted">{s.hint}</span>
              </span>
              {/* Enable / disable switch: enabled = see and change the page, disabled = page hidden. */}
              {(() => {
                const on = admin || enabled[s.key];
                return (
                  <button type="button" role="switch" aria-checked={on} aria-label={`${s.label}: ${on ? "enabled" : "disabled"}`} disabled={admin}
                          onClick={() => setEnabled((current) => ({ ...current, [s.key]: !current[s.key] }))}
                          className="inline-flex items-center gap-2.5 rounded-md px-1 py-1 disabled:cursor-default">
                    <span className={`w-16 text-right text-xs font-semibold ${on ? "text-inc" : "text-ink-muted"}`}>{on ? "Enabled" : "Disabled"}</span>
                    <span aria-hidden className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? "bg-accent" : "bg-neutral-300"}`}>
                      <span className={`absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
                    </span>
                  </button>
                );
              })()}
            </li>
          ))}
        </ul>
      </section>
      {!admin && user.role === "warehouse_manager" && (
        <p className="mt-3 text-xs text-ink-muted">
          A Warehouse Manager sets the US delivery marks (Delivered to SASH US, Delivered to Deere) when Orders is enabled.
        </p>
      )}
    </Sheet>
  );
}
