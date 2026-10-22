"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AppSettingItem } from "@/lib/types";
import { useToast } from "../toast";
import { useApi } from "../use-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Input, Select, Textarea } from "../ui/field";
import { InfoTip } from "../ui/info-tip";
import { Skeleton } from "../ui/skeleton";
import { TINTS } from "../ui/tint";
import { CATEGORY_STYLE } from "./settings-chrome";

// The settings of one group (a Settings page): every field with the value in use, and Save / Discard. A value saved
// here replaces the one in .env. Secrets are never shown: type a new one to replace it.
// `readOnly`: Admin Settings view permission only (fields locked, no Save).
export function SettingsForm({ group, title, description, category, readOnly = false }: {
  group: string; title: string; description: string; category?: string; readOnly?: boolean;
}) {
  const style = category ? CATEGORY_STYLE[category] : undefined;
  const Icon = style?.icon;
  const notify = useToast();
  const { data, error, loading, reload } = useApi<{ data: AppSettingItem[] }>("/api/settings");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const items = (data?.data ?? []).filter((i) => i.group === group);
  const changed = Object.keys(edits).length;

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch("/api/settings", { settings: edits });
      notify(`${changed} setting${changed === 1 ? "" : "s"} saved.`);
      setEdits({});
      reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save the settings.");
    } finally {
      setSaving(false);
    }
  }

  // A container: each row puts the label beside the field only when the card is wide enough (not by screen width).
  return (
    <div className="@container">
      {/* Coloured in the page's category colour: a bar on top, a wash behind the title and the category icon. */}
      <header className={`flex flex-wrap items-start justify-between gap-3 border-b border-line border-t-4 bg-gradient-to-r to-white px-6 py-5 ${
        style ? `${style.top} ${TINTS[style.tint].wash}` : "border-t-transparent from-white"}`}>
        <div className="flex min-w-0 items-start gap-3">
          {Icon && <span aria-hidden className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-line ${style!.text}`}><Icon size={18} /></span>}
          <div className="min-w-0">
            {category && <p className={`text-2xs font-semibold uppercase tracking-[0.12em] ${style!.text}`}>{category}</p>}
            <h2 className="text-xl font-semibold text-ink">{title}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {readOnly && <Badge>View only</Badge>}
          {!readOnly && changed > 0 && <Button variant="ghost" onClick={() => setEdits({})} disabled={saving}>Discard</Button>}
          {!readOnly && <Button variant="primary" onClick={save} disabled={!changed || saving}>
            {saving ? "Saving…" : changed ? `Save ${changed} change${changed === 1 ? "" : "s"}` : "Saved"}
          </Button>}
        </div>
      </header>
      {saveError && <div className="px-6 pt-4"><Alert>{saveError}</Alert></div>}
      {error ? <div className="p-6"><Alert title="Could not load the settings">{error.message}</Alert></div> : loading && !data ? (
        <div className="space-y-4 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : (
        <fieldset disabled={readOnly} className="divide-y divide-neutral-100">
          {items.map((item) => (
            <SettingRow key={item.key} item={item} value={edits[item.key]}
                        onChange={(value) => setEdits((e) => {
                          const next = { ...e };
                          if (value === undefined) delete next[item.key];
                          else next[item.key] = value;
                          return next;
                        })} />
          ))}
        </fieldset>
      )}
    </div>
  );
}

// The value a setting has now: saved on the page, else from .env (address lines as real lines), else (for a choice)
// its default.
function effectiveValue(item: AppSettingItem) {
  const env = item.kind === "textarea" ? item.env_value?.replace(/\\n/g, "\n") : item.env_value;
  return item.value || env || (item.kind === "select" ? item.default_value : null) || "";
}

// One setting: its label (the hint in an "i" tooltip) on the left, the input with the value in use on the right (the
// card's width keeps the inputs a readable length).
// `value` is the unsaved edit (undefined: unchanged); an edit back to the value in use counts as no change.
function SettingRow({ item, value, onChange }: { item: AppSettingItem; value: string | undefined; onChange: (value: string | undefined) => void }) {
  const inUse = effectiveValue(item);
  const current = value ?? inUse;
  const change = (next: string) => onChange(next === inUse ? undefined : next);
  const id = `setting-${item.key}`;
  const placeholder = item.default_value ? item.default_value : "";
  return (
    <div id={item.key} className="grid gap-2 px-6 py-4 transition-colors odd:bg-neutral-50/60 hover:bg-tint-violet/30 @2xl:grid-cols-[13rem_minmax(0,1fr)] @2xl:items-start @2xl:gap-6">
      <label htmlFor={id} className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink @2xl:pt-2">
        {item.label}
        {item.hint && <InfoTip label={`About ${item.label}`}>{item.hint}</InfoTip>}
        {value !== undefined && <Badge tone="warn">Unsaved</Badge>}
      </label>
      {item.kind === "textarea" ? (
        <Textarea id={id} rows={3} className="w-full" value={current} placeholder={placeholder} onChange={(e) => change(e.target.value)} />
      ) : item.kind === "select" ? (
        <Select id={id} className="w-full md:w-60" value={current} onChange={(e) => change(e.target.value)}>
          {!current && <option value="">Choose…</option>}
          {(item.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : item.kind === "secret" ? (
        <Input id={id} type="password" autoComplete="new-password" className="w-full" value={value ?? ""}
               placeholder={item.set ? "•••••••• (type a new value to replace it)" : ""} onChange={(e) => onChange(e.target.value || undefined)} />
      ) : (
        <Input id={id} className="w-full" value={current} placeholder={placeholder} onChange={(e) => change(e.target.value)} />
      )}
    </div>
  );
}
