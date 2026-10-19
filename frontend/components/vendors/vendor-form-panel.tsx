"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Currency, GstTreatment, Vendor, VendorType } from "@/lib/types";
import { TruckIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { Sheet } from "../ui/sheet";
import { Tabs } from "../ui/tabs";

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr."];
const LANGUAGES = ["English", "Hindi", "Punjabi", "Gujarati", "Marathi", "Tamil", "Chinese", "Spanish"];
const CURRENCIES: Currency[] = ["INR", "USD", "EUR", "CNY", "GBP"];
const GST_TREATMENTS: { value: GstTreatment; label: string }[] = [
  { value: "registered_regular", label: "Registered Business - Regular" },
  { value: "registered_composition", label: "Registered Business - Composition" },
  { value: "unregistered", label: "Unregistered Business" },
  { value: "consumer", label: "Consumer" },
  { value: "overseas", label: "Overseas" },
  { value: "sez", label: "Special Economic Zone" },
  { value: "deemed_export", label: "Deemed Export" },
];
const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Other Territory",
];
const PAYMENT_TERMS = ["Due on Receipt", "60 days from date of Dispatch", "90 days from date of Dispatch", "Advance 100 % against Proforma Dispatch"];

type Tab = "other" | "address" | "remarks";

// Every editable field, as text for the inputs (blank = not set).
type Form = {
  name: string; code: string; vendor_type: VendorType; salutation: string; first_name: string; last_name: string;
  company_name: string; email: string; phone: string; mobile: string; language: string; address: string; gst: string;
  gst_treatment: string; place_of_supply: string; pan: string; tax_preference: "taxable" | "tax_exempt"; currency: Currency;
  payment_terms: string; lead_days: string; gst_rate: string; tax_officer_address: string; portal_enabled: boolean; remarks: string;
};

function formOf(vendor?: Vendor): Form {
  return {
    name: vendor?.name ?? "", code: vendor?.code ?? "", vendor_type: vendor?.vendor_type ?? "business",
    salutation: vendor?.salutation ?? "", first_name: vendor?.first_name ?? "", last_name: vendor?.last_name ?? "",
    company_name: vendor?.company_name ?? "", email: vendor?.email ?? "", phone: vendor?.phone ?? "", mobile: vendor?.mobile ?? "",
    language: vendor?.language ?? "English", address: vendor?.address ?? "", gst: vendor?.gst ?? "",
    gst_treatment: vendor?.gst_treatment ?? "", place_of_supply: vendor?.place_of_supply ?? "", pan: vendor?.pan ?? "",
    tax_preference: vendor?.tax_preference ?? "taxable", currency: vendor?.currency ?? "INR", payment_terms: vendor?.payment_terms ?? "",
    lead_days: vendor?.lead_days?.toString() ?? "", gst_rate: vendor?.gst_rate ?? "", tax_officer_address: vendor?.tax_officer_address ?? "",
    portal_enabled: vendor?.portal_enabled ?? false, remarks: vendor?.remarks ?? "",
  };
}

// Side panel to add a vendor, or edit one (`vendor` given): type, primary contact, company and display name, Vendor
// Code (the supplier acronym in PO numbers), email, phones and language; then tax and payment details (GST treatment,
// place of supply, GSTIN, PAN, GST rate, currency, payment terms, lead days), the address with the jurisdictional tax
// officer (for the Intimation Letter) and remarks.
export function VendorFormPanel({ vendor, onClose, onSaved }: { vendor?: Vendor; onClose: () => void; onSaved: (vendor: Vendor) => void }) {
  const notify = useToast();
  const [form, setForm] = useState<Form>(() => formOf(vendor));
  const [tab, setTab] = useState<Tab>("other");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof Form) => ({
    value: form[key] as string, invalid: !!errors[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(key, e.target.value as never),
  });

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: "Enter the display name." });
      return;
    }
    if (form.lead_days.trim() && !/^\d+$/.test(form.lead_days.trim())) return setErrors({ lead_days: "Enter whole days." });
    if (form.gst_rate.trim() && !/^\d+(\.\d{1,2})?$/.test(form.gst_rate.trim())) return setErrors({ gst_rate: "Enter a rate like 18 or 0.1." });
    setSaving(true);
    setError(null);
    setErrors({});
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    try {
      const res = vendor
        ? await api.patch<{ data: Vendor }>(`/api/vendors/${vendor.id}`, body)
        : await api.post<{ data: Vendor }>("/api/vendors", body);
      notify(vendor ? `Vendor ${res.data.name} saved.` : `Vendor ${res.data.name} added.`);
      onSaved(res.data);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        setErrors(Object.fromEntries(Object.entries(err.details as Record<string, string[]>).map(([k, v]) => [k, v.join(", ")])));
      }
      setError(err instanceof ApiError ? err.message : "Could not save the vendor.");
      setSaving(false);
    }
  }

  // Labels beside the fields when the form is wide enough, above them in a narrow panel (container query on the form).
  const row = "grid gap-1.5 @xl:grid-cols-[11rem_minmax(0,1fr)] @xl:items-center @xl:gap-4";
  const label = "text-sm font-medium text-ink";
  const fieldError = (key: keyof Form) => errors[key] && <p className="text-sm font-medium text-dec @xl:col-start-2">{errors[key]}</p>;

  return (
    <Sheet
      open
      onClose={onClose}
      title={vendor ? "Edit vendor" : "Add vendor"}
      description={vendor ? "Edit the vendor's details. Its parts stay as they are." : "Add the vendor, then add its parts from the vendor's panel."}
      icon={<TruckIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      {/* Inputs and selects may shrink below their natural width, so nothing overflows the panel sideways. */}
      <form onSubmit={save} className="@container space-y-4 rounded-lg border border-line bg-white px-5 py-4 shadow-card [&_input]:min-w-0 [&_select]:min-w-0">
        {error && <p className="rounded-md bg-age-red px-3 py-2 text-sm text-age-red-ink">{error}</p>}

        <div className={row}>
          <span className={label}>Vendor Type</span>
          <span className="flex gap-5">
            {(["business", "individual"] as const).map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="radio" name="vendor_type" checked={form.vendor_type === t} onChange={() => set("vendor_type", t)}
                       className="h-4 w-4 accent-[var(--color-accent)]" />
                {t === "business" ? "Business" : "Individual"}
              </label>
            ))}
          </span>
        </div>

        <div className={row}>
          <label htmlFor="vendor-first-name" className={label}>Contact Person</label>
          <span className="grid gap-2 @md:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)]">
            <Select aria-label="Salutation" {...text("salutation")}>
              <option value="">Salutation</option>
              {SALUTATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input id="vendor-first-name" placeholder="First Name" maxLength={100} {...text("first_name")} />
            <Input aria-label="Last Name" placeholder="Last Name" maxLength={100} {...text("last_name")} />
          </span>
        </div>

        <div className={row}>
          <label htmlFor="vendor-company" className={label}>Company Name</label>
          <Input id="vendor-company" maxLength={200} {...text("company_name")} />
        </div>

        <div className={row}>
          <label htmlFor="vendor-name" className={`${label} text-dec`}>Display Name*</label>
          <Input id="vendor-name" autoFocus maxLength={200} {...text("name")} />
          {fieldError("name")}
        </div>

        <div className={row}>
          <label htmlFor="vendor-code" className={label}>Vendor Code</label>
          <span className="flex flex-wrap items-center gap-3">
            <Input id="vendor-code" maxLength={20} className="w-40 uppercase" placeholder="e.g. GR" {...text("code")} />
            <span className="text-xs text-ink-muted">Used in PO numbers, e.g. 5500936294/<b>GR</b>/30-04-26</span>
          </span>
          {fieldError("code")}
        </div>

        <div className={row}>
          <label htmlFor="vendor-email" className={label}>Email</label>
          <Input id="vendor-email" maxLength={500} placeholder="orders@vendor.com, sales@vendor.com" {...text("email")} />
          {fieldError("email")}
        </div>

        <div className={row}>
          <label htmlFor="vendor-phone" className={label}>Contact No</label>
          <span className="grid gap-2 @md:grid-cols-2">
            <Input id="vendor-phone" type="tel" maxLength={200} placeholder="Contact No" {...text("phone")} />
            <Input aria-label="Mobile" type="tel" maxLength={200} placeholder="Mobile" {...text("mobile")} />
          </span>
          {fieldError("phone")}
        </div>

        <div className={row}>
          <label htmlFor="vendor-language" className={label}>Language</label>
          <Select id="vendor-language" className="@md:w-60" {...text("language")}>
            {[...new Set([form.language, ...LANGUAGES])].filter(Boolean).map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>

        <div className="border-b border-line pt-2">
          <Tabs<Tab> tabs={[{ key: "other", label: "Other Details" }, { key: "address", label: "Address" }, { key: "remarks", label: "Remarks" }]}
                     active={tab} onChange={setTab} />
        </div>

        {tab === "other" && (
          <div className="space-y-4">
            <div className={row}>
              <label htmlFor="vendor-gst-treatment" className={label}>GST Treatment</label>
              <Select id="vendor-gst-treatment" {...text("gst_treatment")}>
                <option value="">Select a GST treatment</option>
                {GST_TREATMENTS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </div>
            <div className={row}>
              <label htmlFor="vendor-gstin" className={label}>GSTIN</label>
              <Input id="vendor-gstin" maxLength={32} className="uppercase" placeholder="06AABCS1234F1Z5" {...text("gst")} />
            </div>
            <div className={row}>
              <label htmlFor="vendor-place" className={label}>Place of Supply</label>
              <Select id="vendor-place" {...text("place_of_supply")}>
                <option value="" />
                {[...new Set([form.place_of_supply, ...STATES])].filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div className={row}>
              <label htmlFor="vendor-pan" className={label}>PAN</label>
              <Input id="vendor-pan" maxLength={10} className="uppercase @md:w-60" {...text("pan")} />
            </div>
            <div className={row}>
              <label htmlFor="vendor-gst-rate" className={label}>GST Rate (%)</label>
              <span className="flex flex-wrap items-center gap-3">
                <Input id="vendor-gst-rate" inputMode="decimal" className="w-28" placeholder="18 or 0.1" {...text("gst_rate")} />
                <span className="text-xs text-ink-muted">0.1% = concessional rate for export (Intimation Letter)</span>
              </span>
              {fieldError("gst_rate")}
            </div>
            <div className={row}>
              <span className={label}>Tax Preference</span>
              <span className="flex gap-5">
                {(["taxable", "tax_exempt"] as const).map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input type="radio" name="tax_preference" checked={form.tax_preference === t} onChange={() => set("tax_preference", t)}
                           className="h-4 w-4 accent-[var(--color-accent)]" />
                    {t === "taxable" ? "Taxable" : "Tax Exempt"}
                  </label>
                ))}
              </span>
            </div>
            <div className={row}>
              <label htmlFor="vendor-currency" className={label}>Currency</label>
              <Select id="vendor-currency" className="@md:w-60" {...text("currency")}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className={row}>
              <label htmlFor="vendor-terms" className={label}>Payment Terms</label>
              <Input id="vendor-terms" list="vendor-terms-list" maxLength={200} {...text("payment_terms")} />
              <datalist id="vendor-terms-list">{PAYMENT_TERMS.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div className={row}>
              <label htmlFor="vendor-lead-days" className={label}>Lead Days</label>
              <span className="flex flex-wrap items-center gap-3">
                <Input id="vendor-lead-days" inputMode="numeric" className="w-28" {...text("lead_days")} />
                <span className="text-xs text-ink-muted">Days the vendor needs from the PO to dispatch</span>
              </span>
              {fieldError("lead_days")}
            </div>
            <div className={row}>
              <span className={label}>Enable Portal?</span>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={form.portal_enabled} onChange={(e) => set("portal_enabled", e.target.checked)}
                       className="h-4 w-4 accent-[var(--color-accent)]" />
                Allow portal access for this vendor
              </label>
            </div>
          </div>
        )}

        {tab === "address" && (
          <div className="space-y-4">
            <Field label="Address" htmlFor="vendor-address" optional>
              <Textarea id="vendor-address" maxLength={1000} rows={3} className="w-full" {...text("address")} />
            </Field>
            <Field label="Jurisdictional Tax Officer" htmlFor="vendor-tax-officer" hint="Copy-to address on the Intimation Letter sent with each PO."
                   optional>
              <Textarea id="vendor-tax-officer" maxLength={1000} rows={5} className="w-full" {...text("tax_officer_address")} />
            </Field>
          </div>
        )}

        {tab === "remarks" && (
          <Field label="Remarks" htmlFor="vendor-remarks" optional>
            <Textarea id="vendor-remarks" maxLength={2000} rows={5} className="w-full" {...text("remarks")} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
