"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AppSettingItem } from "@/lib/types";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "../icons";
import { useToast } from "../toast";
import { useApi } from "../use-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { Tabs } from "../ui/tabs";
import { SettingsHeader } from "./settings-form";

// Admin Settings → Purchase Order: the PO Terms and Conditions (Indian POs) and the Requirements (overseas POs), edited
// line by line in two tabs with a preview of how they print. Saved as the PO_TERMS / EXPORT_PO_REQUIREMENTS settings in
// their text form (one line each: "* " = bold / black bar, "(a) " = an indented point), which the PDFs read.
type Kind = "text" | "bold" | "point";
type TermLine = { id: string; kind: Kind; label: string; text: string };
type Requirement = { id: string; text: string; bar: boolean };
type Tab = "terms" | "requirements";

const POINT = /^\(([a-z0-9]{1,3})\)\s+(.*)$/i;
const newId = () => Math.random().toString(36).slice(2, 10);
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

function inUse(item: AppSettingItem | undefined) {
  return item?.value || item?.env_value?.replace(/\\n/g, "\n") || item?.default_value || "";
}

function parseTerms(text: string): TermLine[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    if (line.startsWith("* ")) return { id: newId(), kind: "bold", label: "", text: line.slice(2) };
    const m = line.match(POINT);
    return m ? { id: newId(), kind: "point", label: m[1]!, text: m[2]! } : { id: newId(), kind: "text", label: "", text: line };
  });
}

function termsText(lines: TermLine[]) {
  return lines.filter((l) => l.text.trim()).map((l) =>
    l.kind === "bold" ? `* ${l.text.trim()}` : l.kind === "point" ? `(${l.label.trim() || "a"}) ${l.text.trim()}` : l.text.trim()).join("\n");
}

function parseRequirements(text: string): Requirement[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((line) => ({ id: newId(), text: line.startsWith("* ") ? line.slice(2) : line, bar: line.startsWith("* ") }));
}

function requirementsText(list: Requirement[]) {
  return list.filter((r) => r.text.trim()).map((r) => `${r.bar ? "* " : ""}${r.text.trim()}`).join("\n");
}

function move<T>(list: T[], index: number, by: number) {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index + by, 0, item!);
  return next;
}

export function PoTermsEditor({ title, description, category, readOnly }: { title: string; description: string; category?: string; readOnly: boolean }) {
  const { data, error, loading, reload } = useApi<{ data: AppSettingItem[] }>("/api/settings");
  const items = data?.data ?? [];
  const get = (key: string) => items.find((i) => i.key === key);
  // The editor starts from the saved values; it is made again (fresh state) after a save reloads them.
  const version = [inUse(get("PO_TERMS")), inUse(get("EXPORT_PO_REQUIREMENTS"))].join("\u0000");

  if (error) return <div className="p-6"><Alert title="Could not load the settings">{error.message}</Alert></div>;
  if (loading && !data) {
    return (
      <>
        <SettingsHeader title={title} description={description} category={category} />
        <div className="space-y-3 p-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      </>
    );
  }
  return (
    <Editor key={version} title={title} description={description} category={category} readOnly={readOnly} onSaved={reload}
            terms={get("PO_TERMS")} requirements={get("EXPORT_PO_REQUIREMENTS")}
            company={inUse(get("COMPANY_NAME")) || "SASH"} termsUrl={inUse(get("COMPANY_TERMS_URL"))} />
  );
}

function Editor({ title, description, category, readOnly, onSaved, terms, requirements, company, termsUrl }: {
  title: string; description: string; category?: string; readOnly: boolean; onSaved: () => void;
  terms: AppSettingItem | undefined; requirements: AppSettingItem | undefined; company: string; termsUrl: string;
}) {
  const notify = useToast();
  const savedTerms = inUse(terms);
  const savedRequirements = inUse(requirements);
  const [tab, setTab] = useState<Tab>("terms");
  const [lines, setLines] = useState<TermLine[]>(() => parseTerms(savedTerms));
  const [reqs, setReqs] = useState<Requirement[]>(() => parseRequirements(savedRequirements));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<Tab | null>(null);
  // The text box the placeholder buttons insert into (the last one focused), with its cursor.
  const focused = useRef<{ id: string; el: HTMLTextAreaElement } | null>(null);

  const termsChanged = termsText(lines) !== termsText(parseTerms(savedTerms));
  const reqsChanged = requirementsText(reqs) !== requirementsText(parseRequirements(savedRequirements));
  const changed = Number(termsChanged) + Number(reqsChanged);

  async function save() {
    setSaving(true);
    setError(null);
    const settings: Record<string, string> = {};
    if (termsChanged) settings.PO_TERMS = termsText(lines);
    if (reqsChanged) settings.EXPORT_PO_REQUIREMENTS = requirementsText(reqs);
    try {
      await api.patch("/api/settings", { settings });
      notify("Purchase order wording saved. New and regenerated POs use it.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
      setSaving(false);
    }
  }

  function discard() {
    setLines(parseTerms(savedTerms));
    setReqs(parseRequirements(savedRequirements));
  }

  function reset() {
    if (resetting === "terms") setLines(parseTerms(terms?.default_value ?? ""));
    if (resetting === "requirements") setReqs(parseRequirements(requirements?.default_value ?? ""));
    setResetting(null);
  }

  // Puts {company} / {terms_url} at the cursor of the last focused line.
  function insert(token: string) {
    const target = focused.current;
    if (!target) return notify("Click into a line first, then insert.", "error");
    const { el, id } = target;
    const value = el.value;
    const at = el.selectionStart ?? value.length;
    const text = value.slice(0, at) + token + value.slice(el.selectionEnd ?? at);
    if (tab === "terms") setLines((ls) => ls.map((l) => (l.id === id ? { ...l, text } : l)));
    else setReqs((rs) => rs.map((r) => (r.id === id ? { ...r, text } : r)));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + token.length, at + token.length); });
  }

  const fill = (text: string) => text.replaceAll("{company}", company).replaceAll("{terms_url}", termsUrl);
  // Grows with its text (field-sizing), so a long line is never cut off.
  const box = "field-sizing-content min-h-10 w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-5 text-ink focus:border-accent focus:outline-none disabled:bg-neutral-50";
  const iconButton = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-neutral-100 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="@container">
      <SettingsHeader title={title} description={description} category={category}>
        {readOnly && <Badge>View only</Badge>}
        {!readOnly && changed > 0 && <Button variant="ghost" onClick={discard} disabled={saving}>Discard</Button>}
        {!readOnly && (
          <Button variant="primary" onClick={save} disabled={!changed || saving}>
            {saving ? "Saving…" : changed ? `Save ${changed} change${changed === 1 ? "" : "s"}` : "Saved"}
          </Button>
        )}
      </SettingsHeader>
      {error && <div className="px-6 pt-4"><Alert>{error}</Alert></div>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: "terms" as const, label: "Terms and Conditions", count: lines.length },
          { key: "requirements" as const, label: "Overseas Requirements", count: reqs.length },
        ]} />
        {!readOnly && (
          <span className="flex flex-wrap items-center gap-1.5 py-2 text-xs text-ink-muted">
            Insert:
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert("{company}")}
                    className="rounded border border-line bg-white px-2 py-1 font-mono text-ink hover:border-accent hover:text-accent" title={`Company name (${company})`}>
              {"{company}"}
            </button>
            {tab === "terms" && (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert("{terms_url}")}
                      className="rounded border border-line bg-white px-2 py-1 font-mono text-ink hover:border-accent hover:text-accent"
                      title={termsUrl ? `Terms address (${termsUrl})` : "Terms address (set it in Company profile; the line is left out while blank)"}>
                {"{terms_url}"}
              </button>
            )}
          </span>
        )}
      </div>

      <div className="grid gap-6 p-6 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Editor */}
        <fieldset disabled={readOnly} className="min-w-0 space-y-2">
          <p className="text-xs text-ink-muted">
            {tab === "terms"
              ? "Printed at the foot of purchase orders to Indian vendors, in this order. Heading = bold line; Point = indented item like (a)."
              : "The numbered Requirements on purchase orders to overseas vendors. Black bar = printed white on black, like the PO number rule."}
          </p>
          {tab === "terms" ? lines.map((line, i) => (
            <div key={line.id} className="rounded-lg border border-line bg-neutral-50/60 p-2.5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="w-5 text-right text-xs tabular text-ink-faint">{i + 1}</span>
                <span role="radiogroup" aria-label={`Line ${i + 1} style`} className="inline-flex rounded-md border border-line bg-white p-0.5">
                  {(["text", "bold", "point"] as Kind[]).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={line.kind === k}
                            onClick={() => setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, kind: k, label: k === "point" && !l.label ? "a" : l.label } : l)))}
                            className={`rounded px-2.5 py-0.5 text-xs font-semibold ${line.kind === k ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}>
                      {k === "text" ? "Text" : k === "bold" ? "Heading" : "Point"}
                    </button>
                  ))}
                </span>
                {line.kind === "point" && (
                  <label className="flex items-center gap-1 text-xs text-ink-muted">
                    Label (<input value={line.label} maxLength={3} aria-label={`Line ${i + 1} label`}
                                  onChange={(e) => setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, label: e.target.value.replace(/[^a-z0-9]/gi, "") } : l)))}
                                  className="h-6 w-9 rounded border border-neutral-300 bg-white px-1 text-center text-xs text-ink" />)
                  </label>
                )}
                <span className="ml-auto flex items-center">
                  <button type="button" className={iconButton} disabled={i === 0} onClick={() => setLines((ls) => move(ls, i, -1))} title="Move up" aria-label="Move up"><ArrowUpIcon size={14} /></button>
                  <button type="button" className={iconButton} disabled={i === lines.length - 1} onClick={() => setLines((ls) => move(ls, i, 1))} title="Move down" aria-label="Move down"><ArrowDownIcon size={14} /></button>
                  <button type="button" className={`${iconButton} hover:text-dec`} onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))} title="Remove line" aria-label="Remove line"><TrashIcon size={14} /></button>
                </span>
              </div>
              <textarea rows={1} value={line.text} aria-label={`Line ${i + 1}`} placeholder="Type the line…"
                        onFocus={(e) => { focused.current = { id: line.id, el: e.currentTarget }; }}
                        onChange={(e) => setLines((ls) => ls.map((l) => (l.id === line.id ? { ...l, text: oneLine(e.target.value) } : l)))}
                        className={`${box} ${line.kind === "bold" ? "font-semibold" : ""}`} />
            </div>
          )) : reqs.map((req, i) => (
            <div key={req.id} className="flex items-start gap-2 rounded-lg border border-line bg-neutral-50/60 p-2.5">
              <span className="mt-2 w-5 text-right text-xs font-semibold tabular text-ink-muted">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <textarea rows={1} value={req.text} aria-label={`Requirement ${i + 1}`} placeholder="Type the requirement…"
                          onFocus={(e) => { focused.current = { id: req.id, el: e.currentTarget }; }}
                          onChange={(e) => setReqs((rs) => rs.map((r) => (r.id === req.id ? { ...r, text: oneLine(e.target.value) } : r)))}
                          className={`${box} ${req.bar ? "font-semibold" : ""}`} />
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={req.bar} onChange={(e) => setReqs((rs) => rs.map((r) => (r.id === req.id ? { ...r, bar: e.target.checked } : r)))}
                         className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                  Black bar (white text on black)
                </label>
              </div>
              <span className="flex items-center">
                <button type="button" className={iconButton} disabled={i === 0} onClick={() => setReqs((rs) => move(rs, i, -1))} title="Move up" aria-label="Move up"><ArrowUpIcon size={14} /></button>
                <button type="button" className={iconButton} disabled={i === reqs.length - 1} onClick={() => setReqs((rs) => move(rs, i, 1))} title="Move down" aria-label="Move down"><ArrowDownIcon size={14} /></button>
                <button type="button" className={`${iconButton} hover:text-dec`} onClick={() => setReqs((rs) => rs.filter((r) => r.id !== req.id))} title="Remove requirement" aria-label="Remove requirement"><TrashIcon size={14} /></button>
              </span>
            </div>
          ))}
          {!readOnly && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button size="sm" onClick={() => tab === "terms"
                ? setLines((ls) => [...ls, { id: newId(), kind: "text", label: "", text: "" }])
                : setReqs((rs) => [...rs, { id: newId(), text: "", bar: false }])}>
                <PlusIcon size={14} />{tab === "terms" ? "Add line" : "Add requirement"}
              </Button>
              <button type="button" onClick={() => setResetting(tab)} className="text-xs text-ink-muted underline hover:text-ink">Reset to default wording</button>
            </div>
          )}
        </fieldset>

        {/* Preview: as printed on the PO */}
        <aside className="min-w-0 @4xl:sticky @4xl:top-4 @4xl:self-start">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Preview on the PO</p>
          <div className="rounded-lg border border-line bg-white p-4 text-[11px] leading-4 text-neutral-700 shadow-sm">
            {tab === "terms" ? (
              <div className="space-y-1.5">
                {lines.filter((l) => l.text.trim() && !(l.text.includes("{terms_url}") && !termsUrl)).map((l) => (
                  l.kind === "bold" ? <p key={l.id} className="pt-1 font-bold text-neutral-900">{fill(l.text)}</p>
                    : l.kind === "point" ? <p key={l.id} className="flex gap-2 pl-2"><span>({l.label || "a"})</span><span>{fill(l.text)}</span></p>
                      : <p key={l.id} className="text-justify">{fill(l.text)}</p>
                ))}
              </div>
            ) : (
              <div>
                <p className="mb-1.5 text-xs font-bold text-neutral-900">Requirements :-</p>
                <ol className="space-y-1">
                  {reqs.filter((r) => r.text.trim()).map((r, i) => (
                    <li key={r.id} className="flex gap-2">
                      <span className="w-3 shrink-0 text-right">{i + 1}</span>
                      <span className={r.bar ? "bg-black px-1 font-bold text-white" : ""}>{fill(r.text)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          {tab === "terms" && !termsUrl && lines.some((l) => l.text.includes("{terms_url}")) && (
            <p className="mt-2 text-xs text-ink-muted">The line with {"{terms_url}"} is left out until a Terms and conditions URL is set in Company profile.</p>
          )}
        </aside>
      </div>

      {resetting && (
        <ConfirmDialog title={`Reset the ${resetting === "terms" ? "Terms and Conditions" : "Overseas Requirements"}?`} confirmLabel="Reset" tone="primary"
                       onConfirm={reset} onCancel={() => setResetting(null)}>
          The lines go back to the standard SASH wording. Nothing is saved until you click Save.
        </ConfirmDialog>
      )}
    </div>
  );
}
