"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Vendor, VendorProduct } from "@/lib/types";
import { formatCount, formatQty } from "@/lib/format";
import { PencilIcon, PlusIcon, TruckIcon } from "../icons";
import { ProductPanel } from "../products/product-panel";
import { useToast } from "../toast";
import { useApi, useDebounced } from "../use-api";
import { Button } from "../ui/button";
import { Alert, Spinner } from "../ui/feedback";
import { SearchInput } from "../ui/search-input";
import { Sheet } from "../ui/sheet";
import { Tabs } from "../ui/tabs";
import { formatAmount } from "./price-format";
import { VendorDetails } from "./vendor-details-panel";

const NUMBER = /^\d+(\.\d{1,4})?$/;
const dash = <span className="text-neutral-300">—</span>;
const inputClass = "tabular h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm text-ink focus:border-neutral-500 focus:outline-none";

// One panel per vendor (Vendors page): Details (contact, tax, address) and Parts (what it supplies, with its price per
// piece, MOQ and Current Inventory). A part opens the part panel, where its prices are edited; an admin adds parts here
// and edits the vendor (Edit vendor).
export function VendorPanel({ vendor, canEdit, onClose, onEdit, onChanged }: {
  vendor: Vendor; canEdit: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<"details" | "parts">("details");
  const [part, setPart] = useState<number | null>(null);

  return (
    <>
      <Sheet open wide onClose={onClose} title={vendor.name} icon={<TruckIcon size={18} />}
             description={<>{vendor.code ? <>Vendor Code <b className="text-ink">{vendor.code}</b> · </> : null}{formatCount(vendor.product_count)} part{vendor.product_count === 1 ? "" : "s"}</>}
             footer={canEdit && <Button variant="primary" onClick={onEdit}><PencilIcon size={15} />Edit vendor</Button>}>
        <div className="-mt-2 mb-4 border-b border-line">
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: "details" as const, label: "Details" },
            { key: "parts" as const, label: "Parts", count: vendor.product_count },
          ]} />
        </div>
        {tab === "details" ? <VendorDetails vendor={vendor} /> : <VendorParts vendor={vendor} canEdit={canEdit} onOpen={setPart} onChanged={onChanged} />}
      </Sheet>
      {part !== null && <ProductPanel productId={part} canEdit={canEdit} onClose={() => setPart(null)} onSaved={onChanged} />}
    </>
  );
}

// The vendor's parts: Part Number, description, price per piece, MOQ and Current Inventory. A row opens the part panel.
function VendorParts({ vendor, canEdit, onOpen, onChanged }: { vendor: Vendor; canEdit: boolean; onOpen: (productId: number) => void; onChanged: () => void }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<{ data: VendorProduct[] }>(`/api/vendors/${vendor.id}/products`, { q });
  const [adding, setAdding] = useState(false);
  const items = data?.data ?? [];

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <SearchInput label="Search parts" placeholder="Search part, SASH or vendor part" value={search} onSearch={setSearch} className="w-full sm:w-72" />
        {canEdit && !adding && <Button size="sm" variant="primary" className="ml-auto" onClick={() => setAdding(true)}><PlusIcon size={14} />Add part</Button>}
      </div>
      {adding && <AddPart vendor={vendor} onDone={(saved) => { setAdding(false); if (saved) { reload(); onChanged(); } }} />}
      {error ? <div className="p-4"><Alert title="Could not load the parts">{error.message}</Alert></div> : loading && !data ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">{q ? "No parts match." : "No parts yet."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-2xs font-bold uppercase tracking-wider text-neutral-600">
                <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-5 text-left">Part Number</th>
                <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-3 text-left">Description</th>
                <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-3 text-right">Price per piece</th>
                <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-3 text-right">MOQ (pcs)</th>
                <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-5 text-right">Current Inventory</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} onClick={() => onOpen(item.product_id)} aria-haspopup="dialog" title="Open the part to see or edit its prices"
                    className="cursor-pointer transition-colors hover:bg-neutral-50">
                  <td className="h-11 border-b border-neutral-100 px-5 font-medium text-ink">{item.part_number}</td>
                  <td className="max-w-64 truncate border-b border-neutral-100 px-3 text-ink-muted" title={item.description ?? undefined}>{item.description ?? dash}</td>
                  <td className="tabular border-b border-neutral-100 px-3 text-right font-medium text-ink">{formatAmount(item.price_amount, item.price_currency) ?? (item.price_text || dash)}</td>
                  <td className="tabular border-b border-neutral-100 px-3 text-right">{item.moq !== null ? formatQty(item.moq) : dash}</td>
                  <td className="tabular border-b border-neutral-100 px-5 text-right">{item.available_qty !== null ? formatQty(item.available_qty) : dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Add a part to the vendor: its Part Number (must be in Products), price per piece, MOQ and Current Inventory.
function AddPart({ vendor, onDone }: { vendor: Vendor; onDone: (saved: boolean) => void }) {
  const notify = useToast();
  const [values, setValues] = useState({ part_number: "", price_amount: "", moq: "", available_qty: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!values.part_number.trim()) return setError("Enter the Part Number.");
    const bad = (["price_amount", "moq", "available_qty"] as const).find((k) => values[k].trim() !== "" && !NUMBER.test(values[k].trim()));
    if (bad) return setError("Price, MOQ and Current Inventory must be numbers (or blank).");
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/vendors/${vendor.id}/products`, { ...values, part_number: values.part_number.trim(), price_currency: vendor.currency });
      notify(`${values.part_number.trim().toUpperCase()} added to ${vendor.name}.`);
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the part.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 border-b border-line bg-tint-violet/30 px-5 py-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] sm:items-end">
      {([["part_number", "Part Number", "e.g. JXA22628"], ["price_amount", `Price per piece (${vendor.currency})`, ""], ["moq", "MOQ (pcs)", ""], ["available_qty", "Current Inventory", ""]] as const).map(([key, label, ph]) => (
        <label key={key} className="block text-xs font-medium text-ink-muted">
          {label}
          <input value={values[key]} onChange={set(key)} placeholder={ph} autoFocus={key === "part_number"}
                 inputMode={key === "part_number" ? undefined : "decimal"} className={`mt-1 ${inputClass}`} />
        </label>
      ))}
      <span className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => onDone(false)} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="primary" type="submit" disabled={saving}>{saving ? "Adding…" : "Add"}</Button>
      </span>
      {error && <p className="text-xs text-dec sm:col-span-5">{error}</p>}
    </form>
  );
}
