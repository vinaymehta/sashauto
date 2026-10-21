"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Paginated, Product, Vendor } from "@/lib/types";
import { PlusIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Field, Input, Textarea } from "../ui/field";
import { Sheet } from "../ui/sheet";
import { useApi, useDebounced } from "../use-api";

const NUMBER = /^\d+(\.\d{1,4})?$/;

// Products → Add part (SASH team): a part that is not in an order file or vendor file yet. Part Number, description,
// SASH / vendor part, Commodity Type, pack, MOQ, Deere's price (`currency`: DTP's), and the vendor that supplies it
// (required) with its price per piece and MOQ; more vendors are added in the part panel.
export function AddPartPanel({ currency, onClose, onCreated }: { currency: string; onClose: () => void; onCreated: (product: Product) => void }) {
  const notify = useToast();
  const [v, setV] = useState({
    part_number: "", description: "", sash_part: "", vendor_part: "", commodity_type: "", pack_size: "1", moq_sets: "", customer_price: "",
    vendor_price: "", vendor_moq: "",
  });
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [picking, setPicking] = useState(false); // the vendor list is open (the search box has focus)
  const vq = useDebounced(vendorSearch.trim());
  const vendors = useApi<Paginated<Vendor>>(vendor || !picking ? null : "/api/vendors", { q: vq, per_page: 10 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [key]: e.target.value }));

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const next: Record<string, string> = {};
    if (!v.part_number.trim()) next.part_number = "Enter the Part Number.";
    if (!/^\d+$/.test(v.pack_size.trim()) || Number(v.pack_size) < 1) next.pack_size = "Enter a whole number, 1 or more.";
    if (v.moq_sets.trim() && !NUMBER.test(v.moq_sets.trim())) next.moq_sets = "Enter a number, or leave blank.";
    if (v.customer_price.trim() && !NUMBER.test(v.customer_price.trim())) next.customer_price = "Enter a price, or leave blank.";
    if (!vendor) next.vendor_id = "Choose the vendor that supplies this part.";
    if (v.vendor_price.trim() && !NUMBER.test(v.vendor_price.trim())) next.vendor_price = "Enter a price, or leave blank.";
    if (v.vendor_moq.trim() && !NUMBER.test(v.vendor_moq.trim())) next.vendor_moq = "Enter a number, or leave blank.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ data: Product }>("/api/products", { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])), vendor_id: vendor!.id });
      notify(`Part ${res.data.part_number} added.`);
      onCreated(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        // The vendor's own fields come back as price_amount / moq when its entry is rejected.
        const field: Record<string, string> = { price_amount: "vendor_price" };
        setErrors(Object.fromEntries(Object.entries(err.details as Record<string, string[]>).map(([k, m]) => [field[k] ?? k, m.join(", ")])));
      }
      setError(err instanceof ApiError ? err.message : "Could not add the part.");
      setSaving(false);
    }
  }

  const pack = Math.max(parseInt(v.pack_size, 10) || 1, 1);
  return (
    <Sheet open onClose={onClose} title="Add part" icon={<PlusIcon size={18} />}
           description="A part added by the SASH team, with the vendor that supplies it."
           footer={<>
             <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
             <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Adding…" : "Add part"}</Button>
           </>}>
      <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
        {error && <Alert>{error}</Alert>}
        <Field label="Part Number" htmlFor="ap-part" error={errors.part_number} hint="Deere's Part Number. It cannot be changed later." required>
          <Input id="ap-part" autoFocus className="w-full uppercase" placeholder="e.g. JXA22628" value={v.part_number} onChange={set("part_number")} invalid={!!errors.part_number} />
        </Field>
        <Field label="Description" htmlFor="ap-description" optional>
          <Textarea id="ap-description" rows={2} className="w-full" maxLength={1000} value={v.description} onChange={set("description")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SASH Part" htmlFor="ap-sash" optional><Input id="ap-sash" className="w-full" maxLength={100} value={v.sash_part} onChange={set("sash_part")} /></Field>
          <Field label="Vendor Part" htmlFor="ap-vendor" optional><Input id="ap-vendor" className="w-full" maxLength={100} value={v.vendor_part} onChange={set("vendor_part")} /></Field>
        </div>
        <Field label="Commodity Type" htmlFor="ap-commodity" optional><Input id="ap-commodity" className="w-full" maxLength={100} value={v.commodity_type} onChange={set("commodity_type")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pieces per set" htmlFor="ap-pack" error={errors.pack_size} hint="1 when sold as single pieces." required>
            <Input id="ap-pack" inputMode="numeric" className="w-full" value={v.pack_size} onChange={set("pack_size")} invalid={!!errors.pack_size} />
          </Field>
          <Field label={pack > 1 ? "MOQ (sets)" : "MOQ (pcs)"} htmlFor="ap-moq" error={errors.moq_sets} optional>
            <Input id="ap-moq" inputMode="decimal" className="w-full" value={v.moq_sets} onChange={set("moq_sets")} invalid={!!errors.moq_sets} />
          </Field>
        </div>
        <Field label={`Customer price (${currency}, per 100 pcs)`} htmlFor="ap-price" error={errors.customer_price} hint="Deere's Unit Price, as in the order file." optional>
          <Input id="ap-price" inputMode="decimal" className="w-full" value={v.customer_price} onChange={set("customer_price")} invalid={!!errors.customer_price} />
        </Field>

        <div className="border-t border-neutral-100 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Vendor</h3>
          <div className="space-y-4">
            <Field label="Vendor" htmlFor="ap-vendor-search" error={errors.vendor_id} hint="The vendor that supplies this part. Add more vendors later in the part panel." required>
              {vendor ? (
                <div className="flex h-10 items-center justify-between gap-3 rounded-md border border-neutral-300 bg-white px-3 text-sm">
                  <span className="truncate font-medium text-ink">{vendor.name}{vendor.code && <span className="ml-2 text-xs font-normal text-ink-muted">{vendor.code}</span>}</span>
                  <button type="button" onClick={() => { setVendor(null); setVendorSearch(""); }} className="shrink-0 text-xs text-ink-muted underline hover:text-ink">Change</button>
                </div>
              ) : (
                // A search box whose results open below it while it has focus (a click on a result lands before the blur).
                <div className="relative">
                  <Input id="ap-vendor-search" className="w-full" placeholder="Search a vendor by name or code…" value={vendorSearch} autoComplete="off"
                         role="combobox" aria-expanded={picking} aria-controls="ap-vendor-list"
                         onFocus={() => setPicking(true)} onBlur={() => setTimeout(() => setPicking(false), 150)}
                         onChange={(e) => { setVendorSearch(e.target.value); setPicking(true); }} invalid={!!errors.vendor_id} />
                  {picking && <div id="ap-vendor-list" role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-line bg-white shadow-pop">
                    {(vendors.data?.data ?? []).length === 0
                      ? <p className="px-3 py-2 text-xs text-ink-muted">{vendors.loading ? "Loading…" : "No vendor found."}</p>
                      : vendors.data!.data.map((x) => (
                        <button key={x.id} type="button" role="option" aria-selected={false}
                                onMouseDown={(e) => e.preventDefault()} onClick={() => { setVendor(x); setPicking(false); setErrors((e) => ({ ...e, vendor_id: "" })); }}
                                className="block w-full border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-neutral-50">
                          {x.name}{x.code && <span className="ml-2 text-xs text-ink-muted">{x.code}</span>}
                        </button>
                      ))}
                  </div>}
                </div>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Vendor price per piece${vendor ? ` (${vendor.currency || "INR"})` : ""}`} htmlFor="ap-vendor-price" error={errors.vendor_price} optional>
                <Input id="ap-vendor-price" inputMode="decimal" className="w-full" value={v.vendor_price} onChange={set("vendor_price")} invalid={!!errors.vendor_price} />
              </Field>
              <Field label="Vendor MOQ (pcs)" htmlFor="ap-vendor-moq" error={errors.vendor_moq} optional>
                <Input id="ap-vendor-moq" inputMode="decimal" className="w-full" value={v.vendor_moq} onChange={set("vendor_moq")} invalid={!!errors.vendor_moq} />
              </Field>
            </div>
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
