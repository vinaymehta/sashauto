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

// Users → a user: for each section of the app a View and an Edit checkbox — View = see it ("view"), View + Edit = see and
// change it ("edit"), neither = the page is hidden ("none"). Edit needs View: ticking Edit ticks View, unticking View
// unticks Edit. Admins always have everything. The server enforces the same rules.
export function PermissionsPanel({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: (user: User) => void }) {
  const notify = useToast();
  const admin = user.role === "admin";
  const [levels, setLevels] = useState<Record<Section, Level>>(() => ({ ...user.permissions }));
  // View / Edit ticks → the level: Edit (with View) = edit, View alone = view, none = none.
  const toggle = (section: Section, box: "view" | "edit") => setLevels((current) => {
    const level = current[section];
    const next: Level = box === "edit" ? (level === "edit" ? "view" : "edit") : (level === "none" ? "view" : "none");
    return { ...current, [section]: next };
  });
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
            {admin ? "Admins can see and change everything, and manage users."
              : "View: see the page. Edit: also change things on it. Nothing ticked: the page is hidden. Users is for admins only."}
          </p>
        </header>
        {error && <div className="px-5 pt-3"><Alert>{error}</Alert></div>}
        <div className="flex items-center justify-end gap-6 border-b border-neutral-100 bg-neutral-50 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          <span className="w-12 text-center">View</span>
          <span className="w-12 text-center">Edit</span>
        </div>
        <ul className="divide-y divide-neutral-100">
          {SECTIONS.map((s) => {
            const level = admin ? "edit" : levels[s.key];
            const box = (kind: "view" | "edit", checked: boolean) => (
              <label className={`flex w-12 justify-center ${admin ? "" : "cursor-pointer"}`}>
                <input type="checkbox" checked={checked} disabled={admin} onChange={() => toggle(s.key, kind)}
                       aria-label={`${s.label}: ${kind === "view" ? "View" : "Edit"}`} className="h-4 w-4 accent-[var(--color-accent)]" />
              </label>
            );
            return (
              <li key={s.key} className="flex items-center justify-between gap-6 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{s.label}</span>
                  <span className="block text-xs text-ink-muted">{s.hint}</span>
                </span>
                <span className="flex items-center gap-6">
                  {box("view", level !== "none")}
                  {/* A view-only section (the Dashboard) has nothing to edit. */}
                  {s.viewOnly ? <span className="w-12 text-center text-ink-faint" title="Nothing to edit here">—</span> : box("edit", level === "edit")}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      {!admin && user.role === "warehouse_manager" && (
        <p className="mt-3 text-xs text-ink-muted">
          A Warehouse Manager sets the US delivery marks (Delivered to SASH US, Delivered to Deere) with View on Orders.
        </p>
      )}
    </Sheet>
  );
}
