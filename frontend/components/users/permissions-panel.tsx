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

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "Hidden" },
  { value: "view", label: "View", hint: "See only" },
  { value: "edit", label: "Edit", hint: "See and change" },
];

// Users → a user: what they can do in each section of the app — None (the page is hidden), View (see it, change
// nothing) or Edit. Admins always have full access. The server enforces the same rules.
export function PermissionsPanel({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const notify = useToast();
  const admin = user.role === "admin";
  const [levels, setLevels] = useState<Record<Section, Level>>(() => ({ ...user.permissions }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = SECTIONS.some((s) => levels[s.key] !== user.permissions[s.key]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch<{ data: User }>(`/api/users/${user.id}`, { permissions: levels });
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
            {admin ? "Admins can see and change everything, and manage users." : "What this user can do in each part of the app. Users is for admins only."}
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
              <span role="radiogroup" aria-label={`${s.label} access`} className="inline-flex rounded-md border border-line bg-neutral-50 p-0.5">
                {LEVELS.map((l) => {
                  const on = (admin ? "edit" : levels[s.key]) === l.value;
                  return (
                    <button key={l.value} type="button" role="radio" aria-checked={on} disabled={admin} title={l.hint}
                            onClick={() => setLevels((current) => ({ ...current, [s.key]: l.value }))}
                            className={`rounded px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-default ${on
                              ? l.value === "none" ? "bg-white text-ink shadow-sm" : l.value === "view" ? "bg-tint-aqua text-tint-aqua-ink shadow-sm" : "bg-accent text-white shadow-sm"
                              : "text-ink-muted hover:text-ink"}`}>
                      {l.label}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {!admin && user.role === "warehouse_manager" && (
        <p className="mt-3 text-xs text-ink-muted">
          A Warehouse Manager sets the US delivery marks (Delivered to SASH US, Delivered to Deere) with Orders on View or Edit.
        </p>
      )}
    </Sheet>
  );
}
