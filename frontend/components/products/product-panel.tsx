"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Paginated, PriceChange, Product, ProductConflict, ProductVendor, Vendor } from "@/lib/types";
import { formatDateTime, formatQty } from "@/lib/format";
import { BoxIcon, PencilIcon, PlusIcon, TrashIcon } from "../icons";
import { useToast } from "../toast";
import { useApi, useDebounced } from "../use-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Alert, Spinner } from "../ui/feedback";
import { Sheet } from "../ui/sheet";
import { formatAmount, formatCustomer } from "../vendors/price-format";

type PartResponse = { product: Product; data: ProductVendor[]; customer_price: string | null; history: PriceChange[] };
const NUMBER = /^\d+(\.\d{1,4})?$/;
const dash = <span className="text-neutral-300">—</span>;
const money = (value: string | null, digits = 2) =>
  value === null ? null : Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 4 });
const inputClass = "tabular h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-right text-sm text-ink focus:border-neutral-500 focus:outline-none";

// The one place for a part (Products page, and a vendor's Parts tab): its details (pack, MOQ), Deere's price, every
// vendor with its price per piece, MOQ and Current Inventory, and the price history. An admin edits each in place and
// adds or removes the part's vendors. `onSaved`: after any change (the list behind refreshes). `edit`: open with the
// part details already in edit mode (the pencil in the Products list).
export function ProductPanel({ productId, canEdit, edit = false, onClose, onSaved }: {
  productId: number; canEdit: boolean; edit?: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const { data, error, loading, reload } = useApi<PartResponse>(`/api/products/${productId}/vendors`);
  const product = data?.product;
  const changed = () => { reload(); onSaved?.(); };

  return (
    <Sheet open wide onClose={onClose} title={product?.part_number ?? "Part"} icon={<BoxIcon size={18} />}
           description={product ? (product.description ?? "No description") : "Loading…"}>
      {error ? <Alert title="Could not load the part">{error.message}</Alert> : loading && !data ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : data && product ? (
        <div className="space-y-4">
          {product.open_conflicts.length > 0 && <ConflictsNotice product={product} onSaved={changed} />}
          <PartDetails product={product} canEdit={canEdit} edit={edit} onSaved={changed} />
          <CustomerPrice product={product} price={data.customer_price} canEdit={canEdit} onSaved={changed} />
          <Vendors product={product} items={data.data} canEdit={canEdit} onSaved={changed} />
          <History history={data.history} currency={product.customer_currency ?? "USD"} />
        </div>
      ) : null}
    </Sheet>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

// Part details: description, Commodity Type, SASH / vendor part, pieces per set, MOQ (sets and pieces) and weight.
// Description, Commodity Type, SASH / vendor part, pack and MOQ are edited here (order Qty counts sets, so the MOQ is in sets); the
// Part Number never changes (orders match on it).
function PartDetails({ product, canEdit, edit, onSaved }: { product: Product; canEdit: boolean; edit: boolean; onSaved: () => void }) {
  const notify = useToast();
  const [editing, setEditing] = useState(canEdit && edit);
  const [pack, setPack] = useState(String(product.pack_size ?? 1));
  const [moq, setMoq] = useState(product.moq_sets ?? product.moq ?? "");
  const [text, setText] = useState({
    description: product.description ?? "", commodity_type: product.commodity_type ?? "", sash_part: product.sash_part ?? "", vendor_part: product.vendor_part ?? "",
  });
  const textInput = (key: keyof typeof text, label: string) => (
    <input aria-label={label} value={text[key]} maxLength={100} onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
           className={inputClass.replace("text-right", "text-left")} />
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packSize = Math.max(parseInt(pack, 10) || 1, 1);

  async function save() {
    const value = moq.trim();
    if (value !== "" && (!NUMBER.test(value) || Number(value) <= 0)) return setError("MOQ: enter a number greater than 0, or leave blank.");
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/products/${product.id}`, { pack_size: packSize, moq_sets: value || null, ...text });
      notify(`${product.part_number} saved.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const moqText = product.moq_sets === null && product.moq === null ? null
    : product.pack_size > 1 ? `${formatQty(product.moq_sets ?? "0")} sets · ${formatQty(product.moq ?? "0")} pcs` : formatQty(product.moq ?? product.moq_sets);
  const fields: [string, React.ReactNode][] = [
    ["Commodity Type", editing ? textInput("commodity_type", "Commodity Type") : product.commodity_type],
    ["SASH Part", editing ? textInput("sash_part", "SASH Part") : product.sash_part],
    ["Vendor Part", editing ? textInput("vendor_part", "Vendor Part") : product.vendor_part],
    ["Pieces per set", editing
      ? <input aria-label="Pieces per set" inputMode="numeric" value={pack} onChange={(e) => setPack(e.target.value.replace(/\D/g, "").slice(0, 5))} className={inputClass} />
      : product.pack_size > 1 ? `${product.pack_size} pcs` : "1 (single pieces)"],
    ["MOQ", editing
      ? <span className="flex items-center gap-2"><input aria-label="MOQ" inputMode="decimal" value={moq} placeholder="No MOQ" onChange={(e) => setMoq(e.target.value)} className={inputClass} />
          <span className="text-xs text-ink-muted">{packSize > 1 ? "sets" : "pcs"}</span></span>
      : moqText],
    ["Weight per piece", product.weight_kg !== null ? `${formatQty(product.weight_kg)} kg` : null],
  ];

  return (
    <Card title="Part" action={canEdit && (editing ? (
      <span className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setError(null); }} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </span>
    ) : <Button size="sm" onClick={() => setEditing(true)}><PencilIcon size={14} className="text-ink-muted" />Edit</Button>)}>
      {error && <div className="px-5 pt-3"><Alert>{error}</Alert></div>}
      <div className="border-b border-neutral-100 px-5 py-3">
        <p className="text-xs text-ink-muted">Description</p>
        {editing ? (
          <textarea aria-label="Description" rows={2} maxLength={1000} value={text.description}
                    onChange={(e) => setText((t) => ({ ...t, description: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-ink focus:border-neutral-500 focus:outline-none" />
        ) : <p className="mt-0.5 text-sm font-medium text-ink">{product.description ?? dash}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-px bg-neutral-100 sm:grid-cols-3">
        {fields.map(([label, value]) => (
          <div key={label} className="bg-white px-5 py-3">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">{value ?? dash}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// Deere's price for the part: the order file's Unit Price, per 100 pcs (updated by each upload), and per piece.
function CustomerPrice({ product, price, canEdit, onSaved }: { product: Product; price: string | null; canEdit: boolean; onSaved: () => void }) {
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(price ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = product.customer_currency ?? "USD";

  async function save() {
    const v = value.trim();
    if (v !== "" && !NUMBER.test(v)) return setError("Enter a price with up to 4 decimals, or leave blank.");
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/products/${product.id}`, { customer_price: v || null });
      notify(`Customer price of ${product.part_number} saved.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the customer price.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Customer price (Deere)" action={canEdit && !editing && (
      <Button size="sm" onClick={() => { setValue(price ?? ""); setEditing(true); }}><PencilIcon size={14} className="text-ink-muted" />Edit</Button>
    )}>
      <div className="px-5 py-4">
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32"><input autoFocus aria-label="Customer price per 100 pcs" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} /></span>
            <span className="text-sm text-ink-muted">{currency} per 100 pcs{NUMBER.test(value.trim()) && ` = ${formatCustomer(Number(value) / 100, currency)} per piece`}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        ) : price === null ? (
          <p className="text-sm text-ink-muted">Not set yet. It is taken from the order file&apos;s Unit Price on the next upload.</p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span><span className="tabular text-2xl font-bold text-ink">{formatCustomer(Number(price) / 100, currency)}</span><span className="ml-1 text-sm text-ink-muted">per piece</span></span>
            <span className="text-sm text-ink-muted">({formatCustomer(price, currency)} per 100 pcs, the order file&apos;s Unit Price)</span>
          </p>
        )}
      </div>
    </Card>
  );
}

// Vendors of the part: price per piece (and per set), MOQ and Current Inventory, each edited in place; vendors are
// added and removed here too.
function Vendors({ product, items, canEdit, onSaved }: { product: Product; items: ProductVendor[]; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProductVendor | null>(null);
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const cheapest = items.filter((v) => v.price_amount !== null).sort((a, b) => Number(a.price_amount) - Number(b.price_amount))[0];

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await api.delete(`/api/vendors/${removing.vendor_id}/products/${removing.id}`);
      notify(`${removing.vendor_name} no longer listed for ${product.part_number}.`);
      setRemoving(null);
      onSaved();
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : "Could not remove the vendor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Vendors · ${items.length}`} action={canEdit && !adding && (
      <Button size="sm" variant="primary" onClick={() => { setAdding(true); setEditing(null); }}><PlusIcon size={14} />Add vendor</Button>
    )}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-2xs font-bold uppercase tracking-wider text-neutral-600">
              <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-5 text-left">Vendor</th>
              <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-3 text-right">Price per piece</th>
              <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-3 text-right">MOQ (pcs)</th>
              <th className="h-9 border-b border-neutral-100 bg-neutral-50 px-3 text-right">Current Inventory</th>
              {canEdit && <th className="h-9 w-32 border-b border-neutral-100 bg-neutral-50 px-5 text-right" />}
            </tr>
          </thead>
          <tbody>
            {items.map((v) => editing === v.id
              ? <VendorEditRow key={v.id} product={product} item={v} onDone={(saved) => { setEditing(null); if (saved) onSaved(); }} />
              : (
                <tr key={v.id} className="hover:bg-neutral-50/60">
                  <td className="border-b border-neutral-100 px-5 py-3">
                    <span className="font-medium text-ink">{v.vendor_name}</span>
                    {cheapest?.id === v.id && items.length > 1 && <span className="ml-2"><Badge tone="up">Lowest</Badge></span>}
                  </td>
                  <td className="tabular border-b border-neutral-100 px-3 py-3 text-right">
                    <span className="font-semibold text-ink">{formatAmount(v.price_amount, v.price_currency) ?? (v.price_text || "—")}</span>
                    {v.pack_size > 1 && v.set_price_amount && <span className="block text-xs text-ink-muted">{formatAmount(v.set_price_amount, v.price_currency)} / set of {v.pack_size}</span>}
                  </td>
                  <td className="tabular border-b border-neutral-100 px-3 py-3 text-right">{v.moq !== null ? formatQty(v.moq) : dash}</td>
                  <td className="tabular border-b border-neutral-100 px-3 py-3 text-right">{v.available_qty !== null ? formatQty(v.available_qty) : dash}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap border-b border-neutral-100 px-5 py-3 text-right">
                      <button type="button" onClick={() => { setEditing(v.id); setAdding(false); }} title="Edit price, MOQ and Current Inventory"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-neutral-100 hover:text-ink">
                        <PencilIcon size={14} />
                      </button>
                      <button type="button" onClick={() => { setRemoveError(null); setRemoving(v); }} title={`Remove ${v.vendor_name} from this part`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-neutral-100 hover:text-dec">
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            {adding && <VendorAddRow product={product} existing={items.map((i) => i.vendor_id)} onDone={(saved) => { setAdding(false); if (saved) onSaved(); }} />}
          </tbody>
        </table>
      </div>
      {items.length === 0 && !adding && <p className="px-5 py-6 text-center text-sm text-ink-muted">No vendor supplies this part yet.</p>}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.vendor_name}?`} confirmLabel="Remove" busy={busy} error={removeError}
                       onConfirm={remove} onCancel={() => setRemoving(null)}>
          {removing.vendor_name} will no longer be listed as a vendor of {product.part_number}. The vendor and the part stay.
        </ConfirmDialog>
      )}
    </Card>
  );
}

// Inline edit of one vendor's price per piece, MOQ (pieces) and Current Inventory.
function VendorEditRow({ product, item, onDone }: { product: Product; item: ProductVendor; onDone: (saved: boolean) => void }) {
  const notify = useToast();
  const [price, setPrice] = useState(item.price_amount ?? "");
  const [moq, setMoq] = useState(item.moq ?? "");
  const [available, setAvailable] = useState(item.available_qty ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const bad = [[price, "Price"], [moq, "MOQ"], [available, "Current Inventory"]].find(([v]) => v.trim() !== "" && !NUMBER.test(v.trim()));
    if (bad) return setError(`${bad[1]}: enter a number, or leave blank.`);
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/vendors/${item.vendor_id}/products/${item.id}`, {
        price_amount: price.trim(), moq: moq.trim(), available_qty: available.trim(),
      });
      notify(`${item.vendor_name}: ${product.part_number} saved.`);
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
      setSaving(false);
    }
  }

  return (
    <tr className="bg-tint-violet/30">
      <td className="border-b border-neutral-100 px-5 py-2">
        <span className="font-medium text-ink">{item.vendor_name}</span>
        {error && <span className="mt-1 block text-xs text-dec">{error}</span>}
      </td>
      <td className="border-b border-neutral-100 px-3 py-2">
        <span className="flex items-center gap-1"><input autoFocus aria-label="Price per piece" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
          <span className="text-xs text-ink-muted">{item.price_currency}</span></span>
      </td>
      <td className="border-b border-neutral-100 px-3 py-2"><input aria-label="MOQ in pieces" inputMode="decimal" value={moq} onChange={(e) => setMoq(e.target.value)} className={inputClass} /></td>
      <td className="border-b border-neutral-100 px-3 py-2"><input aria-label="Current Inventory" inputMode="decimal" value={available} onChange={(e) => setAvailable(e.target.value)} className={inputClass} /></td>
      <td className="whitespace-nowrap border-b border-neutral-100 px-5 py-2 text-right">
        <Button size="sm" variant="ghost" onClick={() => onDone(false)} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={saving}>{saving ? "…" : "Save"}</Button>
      </td>
    </tr>
  );
}

// Inline row to add a vendor for the part: search a vendor, then its price per piece, MOQ and Current Inventory.
function VendorAddRow({ product, existing, onDone }: { product: Product; existing: number[]; onDone: (saved: boolean) => void }) {
  const notify = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const { data } = useApi<Paginated<Vendor>>(vendor ? null : "/api/vendors", { q, per_page: 10 });
  const options = (data?.data ?? []).filter((v) => !existing.includes(v.id));
  const [price, setPrice] = useState("");
  const [moq, setMoq] = useState("");
  const [available, setAvailable] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!vendor) return setError("Choose a vendor.");
    const bad = [[price, "Price"], [moq, "MOQ"], [available, "Current Inventory"]].find(([v]) => v.trim() !== "" && !NUMBER.test(v.trim()));
    if (bad) return setError(`${bad[1]}: enter a number, or leave blank.`);
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/vendors/${vendor.id}/products`, {
        part_number: product.part_number, price_amount: price.trim(), moq: moq.trim(), available_qty: available.trim(), price_currency: vendor.currency,
      });
      notify(`${vendor.name} added for ${product.part_number}.`);
      onDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the vendor.");
      setSaving(false);
    }
  }

  return (
    <tr className="bg-tint-violet/30 align-top">
      <td className="border-b border-neutral-100 px-5 py-2">
        {vendor ? (
          <span className="flex items-center gap-2 py-1.5">
            <span className="font-medium text-ink">{vendor.name}</span>
            <button type="button" onClick={() => setVendor(null)} className="text-xs text-ink-muted underline hover:text-ink">change</button>
          </span>
        ) : (
          <span className="relative block">
            <input autoFocus aria-label="Search a vendor" placeholder="Search a vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
                   className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm text-ink focus:border-neutral-500 focus:outline-none" />
            <span className="absolute left-0 right-0 top-9 z-10 block max-h-56 overflow-y-auto rounded-md border border-line bg-white shadow-pop">
              {options.length === 0 ? <span className="block px-3 py-2 text-xs text-ink-muted">No vendor found.</span> : options.map((v) => (
                <button key={v.id} type="button" onClick={() => setVendor(v)} className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50">
                  {v.name}{v.code && <span className="ml-2 text-xs text-ink-muted">{v.code}</span>}
                </button>
              ))}
            </span>
          </span>
        )}
        {error && <span className="mt-1 block text-xs text-dec">{error}</span>}
      </td>
      <td className="border-b border-neutral-100 px-3 py-2">
        <span className="flex items-center gap-1"><input aria-label="Price per piece" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
          <span className="text-xs text-ink-muted">{vendor?.currency ?? "INR"}</span></span>
      </td>
      <td className="border-b border-neutral-100 px-3 py-2"><input aria-label="MOQ in pieces" inputMode="decimal" value={moq} onChange={(e) => setMoq(e.target.value)} className={inputClass} /></td>
      <td className="border-b border-neutral-100 px-3 py-2"><input aria-label="Current Inventory" inputMode="decimal" value={available} onChange={(e) => setAvailable(e.target.value)} className={inputClass} /></td>
      <td className="whitespace-nowrap border-b border-neutral-100 px-5 py-2 text-right">
        <Button size="sm" variant="ghost" onClick={() => onDone(false)} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={saving}>{saving ? "…" : "Add"}</Button>
      </td>
    </tr>
  );
}

// Price history of the part, customer and vendor prices in two tabs (newest first).
function History({ history, currency }: { history: PriceChange[]; currency: string }) {
  const [tab, setTab] = useState<"customer" | "vendor">("customer");
  const shown = history.filter((h) => (h.kind === "customer") === (tab === "customer"));
  return (
    <Card title="Price history" action={
      <div role="tablist" className="flex gap-1 rounded-md bg-subtle p-0.5">
        {(["customer", "vendor"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`rounded px-3 py-1 text-xs font-semibold ${tab === t ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
            {t === "customer" ? "Customer price" : "Vendor price"}
            <span className="ml-1.5 tabular text-ink-faint">{history.filter((h) => (h.kind === "customer") === (t === "customer")).length}</span>
          </button>
        ))}
      </div>
    }>
      {shown.length === 0 ? <p className="px-5 py-6 text-center text-sm text-ink-muted">No {tab} price changes yet.</p> : (
        <ul className="divide-y divide-neutral-100">
          {shown.map((h) => {
            const customer = h.kind === "customer";
            const before = customer ? h.old_amount : (h.old_set_amount ?? h.old_amount);
            const after = customer ? h.new_amount : (h.new_set_amount ?? h.new_amount);
            return (
              <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <span className="tabular text-ink">
                  {before === null ? <span className="text-ink-muted">set to</span> : <span className="text-ink-muted line-through">{customer ? formatCustomer(before, currency) : money(before)}</span>}
                  {" "}<span className="font-semibold">{after === null ? "cleared" : customer ? formatCustomer(after, currency) : money(after)}</span>
                  <span className="ml-1 text-xs text-ink-muted">{customer ? "per 100 pcs" : `${h.currency ?? ""}${h.vendor_name ? ` · ${h.vendor_name}` : ""}`}</span>
                </span>
                <span className="ml-auto text-xs text-ink-muted">
                  {formatDateTime(h.created_at)} · {h.source === "upload" ? `upload${h.upload ? ` ${h.upload}` : ""}` : h.source === "import" ? "vendor file import" : `edited by ${h.changed_by ?? "—"}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// An upload had another Commodity Type than the part: keep the recorded one or use the uploaded one.
function ConflictsNotice({ product, onSaved }: { product: Product; onSaved: () => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  async function resolve(c: ProductConflict, resolution: "kept_existing" | "accepted_incoming") {
    setBusy(c.id);
    try {
      await api.post(`/api/product_conflicts/${c.id}/resolve`, { resolution });
      notify(resolution === "accepted_incoming" ? `Commodity Type changed to ${c.incoming_commodity_type}.` : "Commodity Type kept.");
      onSaved();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not resolve the conflict.", "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Alert tone="warning" title="Commodity Type conflict">
      {product.open_conflicts.map((c) => (
        <span key={c.id} className="mt-1 flex flex-wrap items-center gap-2">
          An upload has <b>{c.incoming_commodity_type}</b>; the part has <b>{c.existing_commodity_type ?? "none"}</b>.
          <Button size="sm" disabled={busy !== null} onClick={() => resolve(c, "kept_existing")}>Keep {c.existing_commodity_type ?? "blank"}</Button>
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => resolve(c, "accepted_incoming")}>Use {c.incoming_commodity_type}</Button>
        </span>
      ))}
    </Alert>
  );
}
