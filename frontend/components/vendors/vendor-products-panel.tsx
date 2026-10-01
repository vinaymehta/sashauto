"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Currency, Vendor, VendorProduct } from "@/lib/types";
import { formatQty } from "@/lib/format";
import { PencilIcon, PlusIcon, TrashIcon, TruckIcon } from "../icons";
import { useApi, useDebounced } from "../use-api";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert, Spinner } from "../ui/feedback";
import { Field, Input, Select, Textarea } from "../ui/field";
import { SearchInput } from "../ui/search-input";
import { Sheet } from "../ui/sheet";

const CURRENCIES: Currency[] = ["INR", "USD", "EUR", "CNY"];
const dash = <span className="text-neutral-300">—</span>;

export function formatPrice(item: Pick<VendorProduct, "price_amount" | "price_currency" | "price_note">) {
  if (item.price_amount === null) return item.price_note ?? null;
  const amount = new Intl.NumberFormat("en-IN", { style: "currency", currency: item.price_currency, maximumFractionDigits: 4 })
    .format(Number(item.price_amount));
  return item.price_note ? `${amount} ${item.price_note}` : amount;
}

const iconButton = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-neutral-100 hover:text-ink";

// Side panel listing the parts of one vendor. Admins can add, edit and remove parts inside the panel.
export function VendorProductsPanel({ vendor, canEdit, onClose, onChanged }: {
  vendor: Vendor; canEdit: boolean; onClose: () => void; onChanged: () => void;
}) {
  const notify = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<{ data: VendorProduct[] }>(`/api/vendors/${vendor.id}/products`, { q });
  const [form, setForm] = useState<VendorProduct | "new" | null>(null);
  const [deleting, setDeleting] = useState<VendorProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const items = data?.data ?? [];

  const changed = () => { reload(); onChanged(); };

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/vendors/${vendor.id}/products/${deleting.id}`);
      notify(`${deleting.part_number} removed from ${vendor.name}.`);
      setDeleting(null);
      changed();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not remove the part.");
    } finally {
      setBusy(false);
    }
  }

  if (form) {
    return <VendorProductForm vendor={vendor} item={form === "new" ? undefined : form} onClose={onClose}
                              onBack={() => setForm(null)} onSaved={() => { setForm(null); changed(); }} />;
  }

  return (
    <Sheet
      open
      wide
      onClose={onClose}
      title={vendor.name}
      description={data ? `${items.length} part${items.length === 1 ? "" : "s"}${q ? " match" : ""} from this vendor.` : "Parts from this vendor."}
      icon={<TruckIcon size={18} />}
    >
      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Products</h3>
          <div className="ml-auto flex items-center gap-2">
            <SearchInput label="Search parts" placeholder="Search part, SASH or vendor part" value={search} onSearch={setSearch} className="w-64" />
            {canEdit && <Button size="sm" variant="primary" onClick={() => setForm("new")}><PlusIcon size={14} />Add part</Button>}
          </div>
        </div>
        {error ? (
          <div className="p-4"><Alert title="Could not load the parts">{error.message}</Alert></div>
        ) : loading && !data ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">{q ? "No parts match." : "No parts yet."}</p>
        ) : (
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-50" : ""}`}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-2xs font-bold uppercase tracking-wider text-neutral-600">
                  {["Customer Part", "SASH Part", "Vendor Part", "Description", "MOQ", "Weight (kg)", "Vendor Price", ...(canEdit ? ["Action"] : [])].map((h) => (
                    <th key={h} className={`h-9 whitespace-nowrap border-b border-neutral-200 bg-neutral-50 px-4 ${
                      ["MOQ", "Weight (kg)", "Vendor Price"].includes(h) ? "text-right" : h === "Action" ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-neutral-50">
                    <td className="h-11 whitespace-nowrap border-b border-neutral-100 px-4 font-medium text-ink">{item.part_number}</td>
                    <td className="whitespace-nowrap border-b border-neutral-100 px-4">{item.sash_part ?? dash}</td>
                    <td className="whitespace-nowrap border-b border-neutral-100 px-4">{item.vendor_part ?? dash}</td>
                    <td className="max-w-72 truncate border-b border-neutral-100 px-4 text-ink-muted" title={item.description ?? undefined}>{item.description ?? dash}</td>
                    <td className="tabular whitespace-nowrap border-b border-neutral-100 px-4 text-right">{item.moq !== null ? formatQty(item.moq) : dash}</td>
                    <td className="tabular whitespace-nowrap border-b border-neutral-100 px-4 text-right">{item.weight_kg !== null ? formatQty(item.weight_kg) : dash}</td>
                    <td className="tabular whitespace-nowrap border-b border-neutral-100 px-4 text-right font-medium">{formatPrice(item) ?? dash}</td>
                    {canEdit && (
                      <td className="whitespace-nowrap border-b border-neutral-100 px-2 text-center">
                        <button type="button" className={iconButton} onClick={() => setForm(item)} aria-label={`Edit ${item.part_number}`} title="Edit">
                          <PencilIcon size={14} />
                        </button>
                        <button type="button" className={`${iconButton} hover:text-dec`} onClick={() => { setDeleteError(null); setDeleting(item); }}
                                aria-label={`Remove ${item.part_number}`} title="Remove">
                          <TrashIcon size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {deleting && (
        <ConfirmDialog title={`Remove ${deleting.part_number}?`} confirmLabel="Remove" busy={busy} error={deleteError}
                       onConfirm={remove} onCancel={() => setDeleting(null)}>
          It will no longer be listed for {vendor.name}. The product itself stays in Products.
        </ConfirmDialog>
      )}
    </Sheet>
  );
}

const NUMBER = /^\d+(\.\d+)?$/;

// Add or edit one part of a vendor, inside the side panel.
function VendorProductForm({ vendor, item, onBack, onClose, onSaved }: {
  vendor: Vendor; item?: VendorProduct; onBack: () => void; onClose: () => void; onSaved: () => void;
}) {
  const notify = useToast();
  const [values, setValues] = useState({
    part_number: item?.part_number ?? "", sash_part: item?.sash_part ?? "", vendor_part: item?.vendor_part ?? "",
    description: item?.description ?? "", moq: item?.moq ?? "", weight_kg: item?.weight_kg ?? "",
    price_amount: item?.price_amount ?? "", price_currency: item?.price_currency ?? "INR", price_note: item?.price_note ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function validate() {
    const next: Record<string, string> = {};
    if (!item && !values.part_number.trim()) next.part_number = "Enter the Part Number.";
    if (values.moq.trim() && (!NUMBER.test(values.moq.trim()) || Number(values.moq) <= 0)) next.moq = "Enter a number greater than 0, or leave blank.";
    if (values.weight_kg.trim() && !NUMBER.test(values.weight_kg.trim())) next.weight_kg = "Enter a number, or leave blank.";
    if (values.price_amount.trim() && !NUMBER.test(values.price_amount.trim())) next.price_amount = "Enter a number, or leave blank.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    const { part_number, ...fields } = values;
    try {
      if (item) await api.patch(`/api/vendors/${vendor.id}/products/${item.id}`, fields);
      else await api.post(`/api/vendors/${vendor.id}/products`, { part_number: part_number.trim(), ...fields });
      notify(item ? `${item.part_number} updated.` : `${part_number.trim().toUpperCase()} added to ${vendor.name}.`);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(Object.fromEntries(Object.entries(err.details as Record<string, string[]>).map(([k, v]) => [k, v.join(", ")])));
      }
      setFormError(err instanceof ApiError ? err.message : "Could not save the part.");
      setSaving(false);
    }
  }

  const field = (key: keyof typeof values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} htmlFor={`vp-${key}`} error={errors[key]} optional={key !== "part_number"} required={key === "part_number"}>
      <Input id={`vp-${key}`} value={values[key]} onChange={set(key)} invalid={!!errors[key]} className="w-full" {...props} />
    </Field>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={item ? `Edit ${item.part_number}` : "Add part"}
      description={vendor.name}
      icon={item ? <PencilIcon size={18} /> : <PlusIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onBack} disabled={saving}>Back</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4">
        {formError && <Alert title="Could not save">{formError}</Alert>}
        <section className="space-y-4 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          {item ? (
            <div>
              <p className="text-sm font-medium text-ink">Customer Part</p>
              <p className="mt-1 font-semibold text-ink">{item.part_number}</p>
            </div>
          ) : field("part_number", "Customer Part (Part Number)", { autoFocus: true, placeholder: "e.g. JXA22628" })}
          <div className="grid grid-cols-2 gap-4">
            {field("sash_part", "SASH Part", { autoFocus: !!item })}
            {field("vendor_part", "Vendor Part")}
          </div>
          <Field label="Description" htmlFor="vp-description" error={errors.description} optional>
            <Textarea id="vp-description" value={values.description} onChange={set("description")} maxLength={1000} className="w-full" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            {field("moq", "MOQ", { inputMode: "decimal" })}
            {field("weight_kg", "Per Pc Weight (kg)", { inputMode: "decimal" })}
          </div>
        </section>
        <section className="space-y-4 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          <div className="grid grid-cols-[1fr_7rem] gap-4">
            {field("price_amount", "Vendor Price", { inputMode: "decimal" })}
            <Field label="Currency" htmlFor="vp-currency">
              <Select id="vp-currency" value={values.price_currency} onChange={set("price_currency")} className="w-full">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          {field("price_note", "Price note", { placeholder: "e.g. EX CHINA", maxLength: 200 })}
        </section>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
