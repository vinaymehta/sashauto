"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { AppSettingItem } from "@/lib/types";
import { FileIcon } from "../icons";
import { useToast } from "../toast";
import { useApi } from "../use-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert } from "../ui/feedback";
import { Skeleton } from "../ui/skeleton";
import { PdfViewer } from "../ui/pdf-viewer";
import { Tabs } from "../ui/tabs";
import { RichEditor, toEditorHtml } from "./rich-editor";
import { SettingsHeader } from "./settings-form";

// Admin Settings → Purchase Order, one tab per purchase order: India PO · SASH format (Terms of Delivery, payment terms,
// Requirements and notices), India PO · Standard format (Terms and Conditions) and Overseas PO (its own Requirements and
// notices). Each India tab shows whether Indian vendors get that format, and can switch to it. Wording is typed and
// formatted as it prints (WYSIWYG).
// "Preview PO" shows a sample PO with the wording on screen, saved or not, in the app's PDF window.
type RichKey = "INDIA_PO_REQUIREMENTS" | "INDIA_PO_NOTICES" | "PO_TERMS" | "EXPORT_PO_REQUIREMENTS" | "EXPORT_PO_NOTICES";
type Key = "PO_FORMAT" | "PO_DELIVERY_TERMS" | "PO_PAYMENT_TERMS" | RichKey;
type Layout = "sash" | "export" | "standard";

const REQUIREMENTS_HINT = "The numbered \"Requirements :-\". Bar = white text on black, like \"PO number must be mentioned on your Tax Invoice\".";
const NOTICES_HINT = "One paragraph per notice: the first prints beside the PAN, the others across the page. Bar = a black box with white text.";

// Rich wording and whether its older plain text was a numbered list.
const RICH: Record<RichKey, { list: boolean; label: string; hint: string }> = {
  INDIA_PO_REQUIREMENTS: { list: true, label: "Requirements (under the items)", hint: REQUIREMENTS_HINT },
  INDIA_PO_NOTICES: { list: false, label: "Notices (foot of the page)", hint: NOTICES_HINT },
  PO_TERMS: { list: false, label: "Terms and Conditions (foot of the page)", hint: "A paragraph starting \"(a) \" prints as an indented point." },
  EXPORT_PO_REQUIREMENTS: { list: true, label: "Requirements (under the items)", hint: REQUIREMENTS_HINT },
  EXPORT_PO_NOTICES: { list: false, label: "Notices (foot of the page)", hint: NOTICES_HINT },
};
const RICH_KEYS = Object.keys(RICH) as RichKey[];
const KEYS: Key[] = ["PO_FORMAT", "PO_DELIVERY_TERMS", "PO_PAYMENT_TERMS", ...RICH_KEYS];

function inUse(item: AppSettingItem | undefined) {
  return item?.value || item?.env_value?.replace(/\\n/g, "\n") || item?.default_value || "";
}

export function PoTermsEditor({ title, description, category, readOnly }: { title: string; description: string; category?: string; readOnly: boolean }) {
  const { data, error, loading, reload } = useApi<{ data: AppSettingItem[] }>("/api/settings");
  const items = data?.data ?? [];
  const get = (key: string) => items.find((i) => i.key === key);
  // The editor starts from the saved values; it is made again (fresh state) after a save reloads them.
  const version = KEYS.map((k) => inUse(get(k))).join("\u0000");

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
            items={Object.fromEntries(KEYS.map((k) => [k, get(k)])) as Record<Key, AppSettingItem | undefined>}
            company={inUse(get("COMPANY_NAME")) || "SASH"} termsUrl={inUse(get("COMPANY_TERMS_URL"))} />
  );
}

function Editor({ title, description, category, readOnly, onSaved, items, company, termsUrl }: {
  title: string; description: string; category?: string; readOnly: boolean; onSaved: () => void;
  items: Record<Key, AppSettingItem | undefined>; company: string; termsUrl: string;
}) {
  const notify = useToast();
  // The saved wording (rich text as the editor's HTML; older plain text converted).
  const saved = Object.fromEntries(KEYS.map((k) => {
    const value = inUse(items[k]);
    return [k, k in RICH ? toEditorHtml(value, RICH[k as RichKey].list) : value];
  })) as Record<Key, string>;
  const [values, setValues] = useState<Record<Key, string>>(saved);
  // Each rich box's starting HTML as the editor writes it (changes are compared with it), what it (re)starts with, and a
  // version that makes it start again (Discard, Reset).
  const [baseline, setBaseline] = useState<Partial<Record<RichKey, string>>>({});
  const [contents, setContents] = useState<Record<RichKey, string>>(() => Object.fromEntries(RICH_KEYS.map((k) => [k, saved[k]])) as Record<RichKey, string>);
  const [versions, setVersions] = useState<Record<RichKey, number>>(() => Object.fromEntries(RICH_KEYS.map((k) => [k, 0])) as Record<RichKey, number>);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<RichKey | null>(null);
  const [tab, setTab] = useState<Layout>("sash");
  // The sample PO being previewed (in the app's PDF window), and which one is being made.
  const [previewing, setPreviewing] = useState<{ url: string; title: string } | null>(null);
  const [making, setMaking] = useState<Layout | null>(null);

  const isRich = (k: Key): k is RichKey => k in RICH;
  const changedKeys = KEYS.filter((k) => (isRich(k) ? baseline[k] !== undefined && values[k] !== baseline[k] : values[k] !== saved[k]));
  const set = (k: Key, v: string) => setValues((vs) => ({ ...vs, [k]: v }));
  const restart = (k: RichKey, html: string) => {
    setContents((cs) => ({ ...cs, [k]: html }));
    setVersions((vs) => ({ ...vs, [k]: vs[k] + 1 }));
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch("/api/settings", { settings: Object.fromEntries(changedKeys.map((k) => [k, values[k]])) });
      notify("Purchase order settings saved. New and regenerated POs use them.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
      setSaving(false);
    }
  }

  function discard() {
    setValues(saved);
    RICH_KEYS.forEach((k) => restart(k, saved[k]));
  }

  // A sample PO in that layout with the wording on screen (not saved), shown in the app's PDF window.
  async function preview(layout: Layout) {
    setMaking(layout);
    try {
      const blob = await api.postBlob("/api/settings/po_preview", { layout, settings: values });
      const title = { sash: "Preview: SASH format PO (sample)", export: "Preview: overseas PO (sample)", standard: "Preview: Standard format PO (sample)" }[layout];
      setPreviewing({ url: URL.createObjectURL(blob), title });
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not make the preview.", "error");
    } finally {
      setMaking(null);
    }
  }

  function closePreview() {
    if (previewing) URL.revokeObjectURL(previewing.url);
    setPreviewing(null);
  }

  const tokens = (withUrl: boolean) => [
    { token: "{company}", title: `Company name (${company})` },
    ...(withUrl ? [{ token: "{terms_url}", title: termsUrl ? `Terms address (${termsUrl})` : "Terms address (set it in Company profile; the paragraph is left out while blank)" }] : []),
  ];
  const rich = (k: RichKey, withUrl = false) => (
    <section key={k} className="space-y-1.5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{RICH[k].label}</h3>
          <p className="text-xs text-ink-muted">{RICH[k].hint}</p>
        </div>
        {!readOnly && <button type="button" onClick={() => setResetting(k)} className="text-xs text-ink-muted underline hover:text-ink">Reset to default wording</button>}
      </div>
      <RichEditor key={versions[k]} label={RICH[k].label} content={contents[k]} readOnly={readOnly} tokens={tokens(withUrl)}
                  onChange={(html) => set(k, html)}
                  onReady={(html) => { setBaseline((b) => ({ ...b, [k]: b[k] ?? html })); set(k, html); }} />
    </section>
  );
  const previewButton = (layout: Layout, label: string) => (
    <Button size="sm" onClick={() => preview(layout)} disabled={making !== null}><FileIcon size={14} />{making === layout ? "Preparing…" : label}</Button>
  );
  const textField = (k: "PO_DELIVERY_TERMS" | "PO_PAYMENT_TERMS", label: string, hint: string) => (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold text-ink">{label}</span>
      <input value={values[k]} disabled={readOnly} onChange={(e) => set(k, e.target.value)} placeholder={items[k]?.default_value ?? ""}
             className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm text-ink focus:border-accent focus:outline-none disabled:bg-neutral-50" />
      <span className="block text-xs text-ink-muted">{hint}</span>
    </label>
  );

  return (
    <div>
      <SettingsHeader title={title} description={description} category={category}>
        {readOnly && <Badge>View only</Badge>}
        {!readOnly && changedKeys.length > 0 && <Button variant="ghost" onClick={discard} disabled={saving}>Discard</Button>}
        {!readOnly && (
          <Button variant="primary" onClick={save} disabled={!changedKeys.length || saving}>
            {saving ? "Saving…" : changedKeys.length ? `Save ${changedKeys.length} change${changedKeys.length === 1 ? "" : "s"}` : "Saved"}
          </Button>
        )}
      </SettingsHeader>
      {error && <div className="px-6 pt-4"><Alert>{error}</Alert></div>}

      {/* One tab per purchase order: India (SASH format), India (Standard format), Overseas. */}
      <div className="border-b border-line px-4 sm:px-6">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: "sash" as const, label: <>India PO · SASH format{values.PO_FORMAT === "sash" && <InUseDot />}</> },
          { key: "standard" as const, label: <>India PO · Standard format{values.PO_FORMAT === "standard" && <InUseDot />}</> },
          { key: "export" as const, label: "Overseas PO" },
        ]} />
      </div>

      <div className="space-y-6 p-4 sm:p-6">
        {/* What this PO is, whether it is in use, and its preview. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-neutral-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm text-ink">{INTRO[tab]}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              {tab === "export" ? (
                <span className="rounded-full bg-tint-violet px-2 py-0.5 font-semibold text-tint-violet-ink">Always used for overseas vendors</span>
              ) : values.PO_FORMAT === tab ? (
                <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-white">In use for Indian vendors</span>
              ) : (
                <>
                  <span className="rounded-full bg-neutral-200 px-2 py-0.5 font-semibold text-ink-muted">Not in use</span>
                  {!readOnly && (
                    <button type="button" onClick={() => set("PO_FORMAT", tab)} className="font-medium text-accent underline underline-offset-2 hover:no-underline">
                      Use this format for Indian vendors
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {previewButton(tab, "Preview PO")}
        </div>

        {tab === "sash" && <>
          <div className="grid gap-4 sm:grid-cols-2">
            {textField("PO_DELIVERY_TERMS", "Terms of Delivery box", "Printed in the Terms of Delivery box.")}
            {textField("PO_PAYMENT_TERMS", "Mode/Terms of Payment box", "For vendors without payment terms of their own.")}
          </div>
          {rich("INDIA_PO_REQUIREMENTS")}
          {rich("INDIA_PO_NOTICES")}
        </>}
        {tab === "standard" && rich("PO_TERMS", true)}
        {tab === "export" && <>
          {rich("EXPORT_PO_REQUIREMENTS")}
          {rich("EXPORT_PO_NOTICES")}
        </>}
      </div>

      {previewing && <PdfViewer url={previewing.url} title={previewing.title} onClose={closePreview} />}

      {resetting && (
        <ConfirmDialog title={`Reset the ${RICH[resetting].label}?`} confirmLabel="Reset" tone="primary"
                       onConfirm={() => { restart(resetting, items[resetting]?.default_value ?? ""); setResetting(null); }} onCancel={() => setResetting(null)}>
          The text goes back to the standard SASH wording. Nothing is saved until you click Save.
        </ConfirmDialog>
      )}
    </div>
  );
}

// The small "in use" mark next to the India format Indian vendors get.
const InUseDot = () => <span className="h-2 w-2 rounded-full bg-accent" title="In use for Indian vendors" aria-label="in use" />;

// What each tab's purchase order is.
const INTRO: Record<Layout, string> = {
  sash: "SASH's purchase order form (your format) for Indian vendors: Requirements, notices and the signature, amount in words in rupees.",
  standard: "The app's own layout for Indian vendors: GST as a row of the table and the Terms and Conditions at the foot.",
  export: "Purchase orders to overseas vendors (China, UK, Europe…), in the vendor's currency, with their own Requirements and notices.",
};
