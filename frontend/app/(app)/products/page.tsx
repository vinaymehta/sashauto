"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Paginated, PriceChange, Product, ProductConflict, ProductVendor, VendorImportResult } from "@/lib/types";
import { formatCount, formatDateTime, formatQty } from "@/lib/format";
import { PencilIcon, TruckIcon } from "@/components/icons";
import { formatMoq, formatPrice } from "@/components/vendors/vendor-products-panel";
import { DtpImportButton } from "@/components/vendors/dtp-import";
import { ImportIssuesPanel, useOpenImportIssues } from "@/components/vendors/import-issues";
import { Tabs } from "@/components/ui/tabs";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { SearchInput } from "@/components/ui/search-input";
import { Alert, EmptyState, Spinner } from "@/components/ui/feedback";
import { FilterChips, FilterMenu, type FilterGroup } from "@/components/ui/filter-menu";
import { PageHeader, Panel } from "@/components/ui/panel";
import { PanelSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td, Th } from "@/components/ui/table";

const FILTERS: FilterGroup[] = [
  { key: "conflicts", label: "Commodity conflicts", options: [{ value: "open", label: "Has open conflicts" }] },
];

export default function ProductsPage() {
  return (
    <Suspense fallback={<PanelSkeleton rows={10} columns={6} />}>
      <ProductsView />
    </Suspense>
  );
}

// Products are created automatically from uploads. Only the MOQ can be edited, by admins.
function ProductsView() {
  const params = useSearchParams(); // deep link from the dashboard / bell: /products?conflicts=open
  const list = useListQuery(params.get("conflicts") === "open" ? { conflicts: "open" } : {}, 10, { key: "part_number", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());

  const isAdmin = useSession().user?.role === "admin";
  const { data, error, loading, reload } = useApi<Paginated<Product>>("/api/products", {
    q, ...list.filters, sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };
  const sortProps = { sort: list.sort, direction: list.direction, onSort: list.toggleSort };
  const [viewing, setViewing] = useState<Product | null>(null);
  // The list, or the Import issues tab (problems from vendor file imports).
  const [view, setView] = useState<"list" | "issues">("list");
  const issues = useOpenImportIssues();
  const onImported = (r: VendorImportResult) => { reload(); issues.reload(); if (r.issues) setView("issues"); };

  return (
    <>
      <PageHeader
        title="Products"
        actions={isAdmin && <DtpImportButton label="Upload file" onImported={onImported} />}
      />
      <div className="flex items-center border-b border-line">
        <Tabs active={view} onChange={setView} tabs={[
          { key: "list" as const, label: "Products", count: data?.meta.total ?? null },
          { key: "issues" as const, label: "Import issues", count: issues.count },
        ]} />
      </div>

      {view === "issues" ? (
        <div className="mt-4"><ImportIssuesPanel canEdit={isAdmin} onChanged={() => { reload(); issues.reload(); }} /></div>
      ) : (
      <div className="mt-4"><Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} product${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search products" placeholder="Search part, SASH, vendor part or description" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        {error ? (
          <div className="p-4"><Alert title="Could not load products">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={6} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No products match" : "No products yet"}
            description={filtered ? "Try a different search or clear the filter." : "Products appear automatically after the first upload."}
            action={filtered ? <Button size="sm" onClick={clearAll}>Clear search and filters</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            {/* Fixed column widths (text + 48px cell padding); Description takes the rest. Below ~1250px the table
                scrolls sideways instead of cutting the columns. */}
            <Table fixed minWidth="min-w-[1250px]">
              <colgroup>
                <col className="w-44" />
                <col className="w-40" />
                <col className="w-44" />
                <col />
                <col className="w-64" />
                <col className="w-40" />
                {isAdmin && <col className="w-28" />}
              </colgroup>
              <thead>
                <tr>
                  <SortTh label="Part Number" sortKey="part_number" {...sortProps} />
                  <SortTh label="SASH Part" sortKey="sash_part" {...sortProps} />
                  <SortTh label="Vendor Part" sortKey="vendor_part" {...sortProps} />
                  <SortTh label="Description" sortKey="description" {...sortProps} />
                  <SortTh label="MOQ" sortKey="moq" align="right" {...sortProps} />
                  <SortTh label="Weight (kg)" sortKey="weight_kg" align="right" {...sortProps} />
                  {isAdmin && <Th align="center">Action</Th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <ProductRow key={p.id} product={p} canEdit={isAdmin} onSaved={reload}
                              active={viewing?.id === p.id} onOpen={() => setViewing(p)} />
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="products" />
          </div>
        ) : null}
      </Panel></div>
      )}
      {viewing && <ProductVendorsPanel key={viewing.id} product={viewing} canEdit={isAdmin} onClose={() => setViewing(null)} onSaved={reload} />}
    </>
  );
}

function conflictNote(c: ProductConflict) {
  const when = c.uploaded_at ? ` on ${formatDateTime(c.uploaded_at)}` : "";
  return `An upload${when} contained Commodity Type ${c.incoming_commodity_type}. The recorded value was kept.`;
}

const MOQ_FORMAT = /^\d+(\.\d{1,3})?$/;

const dash = <span className="text-neutral-300" aria-label="Not set">—</span>;

function ProductRow({ product, canEdit, onSaved, active, onOpen }: {
  product: Product; canEdit: boolean; onSaved: () => void; active: boolean; onOpen: () => void;
}) {
  const conflicts = product.open_conflicts;
  const [editing, setEditing] = useState(false);
  const [resolving, setResolving] = useState(false);

  return (
    <tr onClick={onOpen} aria-haspopup="dialog" aria-expanded={active}
        className={`cursor-pointer transition-colors duration-150 hover:bg-neutral-50 ${active ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`}>
      <Td className="truncate font-medium" title={product.part_number}>
        <span className="inline-flex max-w-full items-center gap-2">
          {product.part_number}
          {conflicts.length > 0 && (
            <button type="button" title={`${conflicts.map(conflictNote).join("\n")}\nClick to review.`} aria-haspopup="dialog"
                    onClick={(e) => { e.stopPropagation(); setResolving(true); }}>
              <Badge tone="warn">{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} · Review</Badge>
            </button>
          )}
          {resolving && (
            <span onClick={(e) => e.stopPropagation()}>
              <ConflictsPanel product={product} onClose={() => setResolving(false)} onSaved={onSaved} />
            </span>
          )}
        </span>
      </Td>
      <Td className="truncate" title={product.sash_part ?? undefined}>{product.sash_part ?? dash}</Td>
      <Td className="truncate" title={product.vendor_part ?? undefined}>{product.vendor_part ?? dash}</Td>
      <Td className="truncate text-ink-muted" title={product.description ?? undefined}>{product.description ?? dash}</Td>
      <Td align="right" className="tabular truncate" title={formatMoq(product) ?? undefined}>{formatMoq(product) ?? dash}</Td>
      <Td align="right" className="tabular">{product.weight_kg !== null ? formatQty(product.weight_kg) : dash}</Td>
      {canEdit && (
        <Td align="center" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" onClick={() => setEditing(true)} aria-haspopup="dialog" aria-expanded={editing}
                  aria-label={`Edit MOQ for ${product.part_number}`} title="Edit MOQ" className="w-8 px-0!">
            <PencilIcon size={14} className="text-ink-muted" />
          </Button>
          {editing && <MoqPanel product={product} onClose={() => setEditing(false)} onSaved={onSaved} />}
        </Td>
      )}
    </tr>
  );
}

// Side panel with the vendors of a product and each vendor's price (from the Vendors list).
type PricesResponse = { data: ProductVendor[]; customer_price: string | null; history: PriceChange[] };
const AMOUNT = /^\d+(\.\d{1,4})?$/;
const money = (value: string | null, digits = 2) =>
  value === null ? null : Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 4 });

// Side panel of one part: the customer price (the order file's Unit Price, per 100 pcs — updated by each upload,
// editable by an admin), the vendors' prices (editable by an admin), and the price history of both.
function ProductVendorsPanel({ product, canEdit, onClose, onSaved }: {
  product: Product; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const notify = useToast();
  const { data, error, loading, reload } = useApi<PricesResponse>(`/api/products/${product.id}/vendors`);
  const items = data?.data ?? [];
  const history = data?.history ?? [];
  const customer = data?.customer_price ?? null;
  const [historyTab, setHistoryTab] = useState<"customer" | "vendor">("customer");
  const shownHistory = history.filter((h) => (h.kind === "customer") === (historyTab === "customer"));
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [customerValue, setCustomerValue] = useState("");
  const [editingVendor, setEditingVendor] = useState<number | null>(null);
  const [vendorValue, setVendorValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function saveCustomer() {
    const value = customerValue.trim();
    if (value !== "" && !AMOUNT.test(value)) return setSaveError("Enter a price with up to 4 decimals, or leave blank.");
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/api/products/${product.id}`, { customer_price: value || null });
      notify(`Customer price of ${product.part_number} saved.`);
      setEditingCustomer(false);
      reload();
      onSaved();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save the customer price.");
    } finally {
      setSaving(false);
    }
  }

  // Vendor price per set for pack parts, per piece otherwise (the other is derived).
  async function saveVendor(v: ProductVendor) {
    const value = vendorValue.trim();
    if (!AMOUNT.test(value)) return setSaveError("Enter a price with up to 4 decimals.");
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/api/vendors/${v.vendor_id}/products/${v.id}`, v.pack_size > 1 ? { set_price_amount: value } : { price_amount: value });
      notify(`${v.vendor_name}'s price saved.`);
      setEditingVendor(null);
      reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save the vendor price.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "tabular h-8 w-28 rounded-md border border-neutral-300 bg-white px-2 text-right text-sm text-ink focus:border-neutral-500 focus:outline-none";

  return (
    <Sheet open onClose={onClose} title={product.part_number}
           description={product.description ?? "Customer and vendor prices of this part."} icon={<TruckIcon size={18} />}>
      <div className="space-y-4">
        {saveError && <Alert>{saveError}</Alert>}
        {error ? (
          <Alert title="Could not load the prices">{error.message}</Alert>
        ) : loading && !data ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <>
            {/* Customer price */}
            <section className="rounded-lg border border-line bg-gradient-to-br from-tint-violet/60 via-white to-white px-5 py-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Customer price</p>
                  {editingCustomer ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input autoFocus inputMode="decimal" value={customerValue} onChange={(e) => setCustomerValue(e.target.value)}
                             aria-label="Customer price per 100 pcs" className={inputClass} />
                      <span className="text-sm text-ink-muted">per 100 pcs</span>
                      <Button size="sm" variant="primary" onClick={saveCustomer} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingCustomer(false)} disabled={saving}>Cancel</Button>
                    </div>
                  ) : customer === null ? (
                    <p className="mt-1 text-sm text-ink-faint">Not set yet — it is taken from the order file&apos;s Unit Price on the next upload.</p>
                  ) : (
                    <p className="mt-1">
                      <span className="tabular text-2xl font-bold text-ink">{money(customer)}</span>
                      <span className="ml-1 text-sm text-ink-muted">per 100 pcs</span>
                      <span className="ml-3 text-sm text-ink-muted">= <span className="tabular font-semibold text-ink">{money(String(Number(customer) / 100), 2)}</span> per piece</span>
                    </p>
                  )}
                </div>
                {canEdit && !editingCustomer && (
                  <Button size="sm" onClick={() => { setSaveError(null); setCustomerValue(customer ?? ""); setEditingCustomer(true); }}>
                    <PencilIcon size={14} className="text-ink-muted" />Edit
                  </Button>
                )}
              </div>
            </section>

            {/* Vendor prices */}
            <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
              <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Vendor prices</h3>
                <span className="text-xs text-ink-muted">{items.length} vendor{items.length === 1 ? "" : "s"}</span>
              </header>
              {items.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-ink-muted">No vendor is listed for this part.</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {items.map((v) => (
                      <tr key={v.id}>
                        <td className="h-12 border-b border-neutral-100 px-5 font-medium text-ink">{v.vendor_name}</td>
                        <td className="tabular whitespace-nowrap border-b border-neutral-100 px-5 text-right text-ink">
                          {editingVendor === v.id ? (
                            <span className="inline-flex items-center gap-2">
                              <input autoFocus inputMode="decimal" value={vendorValue} onChange={(e) => setVendorValue(e.target.value)}
                                     aria-label={`Price for ${v.vendor_name}`} className={inputClass} />
                              <span className="text-xs text-ink-muted">{v.price_currency} / {v.pack_size > 1 ? `set of ${v.pack_size}` : "pc"}</span>
                              <Button size="sm" variant="primary" onClick={() => saveVendor(v)} disabled={saving}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingVendor(null)} disabled={saving}>Cancel</Button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              {formatPrice(v) ?? dash}
                              {canEdit && (
                                <button type="button" title="Edit price" aria-label={`Edit ${v.vendor_name}'s price`}
                                        onClick={() => { setSaveError(null); setVendorValue((v.pack_size > 1 ? v.set_price_amount : v.price_amount) ?? ""); setEditingVendor(v.id); }}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink">
                                  <PencilIcon size={14} />
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Price history */}
            <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Price history</h3>
                <div role="tablist" className="flex gap-1 rounded-md bg-subtle p-0.5">
                  {(["customer", "vendor"] as const).map((tab) => (
                    <button key={tab} type="button" role="tab" aria-selected={historyTab === tab} onClick={() => setHistoryTab(tab)}
                            className={`rounded px-3 py-1 text-xs font-semibold ${historyTab === tab ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}>
                      {tab === "customer" ? "Customer price" : "Vendor price"}
                      <span className="ml-1.5 tabular text-ink-faint">{history.filter((h) => (h.kind === "customer") === (tab === "customer")).length}</span>
                    </button>
                  ))}
                </div>
              </header>
              {shownHistory.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-ink-muted">No {historyTab} price changes yet.</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {shownHistory.map((h) => {
                    const customerChange = h.kind === "customer";
                    const before = customerChange ? h.old_amount : (h.old_set_amount ?? h.old_amount);
                    const after = customerChange ? h.new_amount : (h.new_set_amount ?? h.new_amount);
                    const up = before !== null && after !== null && Number(after) > Number(before);
                    const down = before !== null && after !== null && Number(after) < Number(before);
                    return (
                      <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                        <span className="tabular text-ink">
                          {before === null ? <span className="text-ink-muted">set to</span> : <span className="text-ink-muted line-through">{money(before)}</span>}
                          {" "}<span className={`font-semibold ${(customerChange ? up : down) ? "text-inc" : (customerChange ? down : up) ? "text-dec" : "text-ink"}`}>{after === null ? "cleared" : money(after)}</span>
                          <span className="ml-1 text-xs text-ink-muted">{customerChange ? "per 100 pcs" : h.currency ?? ""}</span>
                        </span>
                        <span className="ml-auto text-xs text-ink-muted">
                          {formatDateTime(h.created_at)} · {h.source === "upload" ? `upload${h.upload ? ` ${h.upload}` : ""}` : h.source === "import" ? "vendor file import" : `edited by ${h.changed_by ?? "—"}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}

// Side panel for editing a product's MOQ and pieces per set. Order Qty counts sets, so the MOQ is entered in sets
// (pieces derived). Blank clears the MOQ.
function MoqPanel({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [pack, setPack] = useState(String(product.pack_size ?? 1));
  const [value, setValue] = useState(product.moq_sets ?? product.moq ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packSize = Math.max(parseInt(pack, 10) || 1, 1);
  const moqPcs = MOQ_FORMAT.test(value.trim()) ? String(Number(value) * packSize) : null;

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const moq = value.trim();
    if (moq !== "" && (!MOQ_FORMAT.test(moq) || Number(moq) <= 0)) {
      setError("Enter a number greater than 0, or leave blank.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/products/${product.id}`, { pack_size: packSize, moq_sets: moq || null });
      notify(moq ? `MOQ for ${product.part_number} set to ${formatMoq({ moq: moqPcs, moq_sets: moq, pack_size: packSize })}.` : `MOQ for ${product.part_number} cleared.`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the MOQ.");
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit MOQ"
      description="Order rows with a Qty (in sets) below the MOQ are emailed as MOQ alerts on the next upload."
      icon={<PencilIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-4 text-left">
        <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-white shadow-card">
          <div className="border-r border-neutral-100 px-5 py-3">
            <dt className="text-xs font-medium text-ink-muted">Part Number</dt>
            <dd className="mt-0.5 font-semibold text-ink">{product.part_number}</dd>
          </div>
          <div className="px-5 py-3">
            <dt className="text-xs font-medium text-ink-muted">Commodity Type</dt>
            <dd className="mt-0.5 font-semibold text-ink">{product.commodity_type ?? "—"}</dd>
          </div>
        </dl>
        <form onSubmit={save} className="rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          <div className="space-y-4">
            <Field label="Pieces per set" htmlFor="product-pack" hint="1 when the part is sold as single pieces." required>
              <Input id="product-pack" inputMode="numeric" value={pack} className="w-full"
                     onChange={(e) => setPack(e.target.value.replace(/\D/g, "").slice(0, 5))} />
            </Field>
            <Field label={packSize > 1 ? "MOQ (sets)" : "MOQ"} htmlFor="product-moq" error={error} optional
                   hint={packSize > 1 && moqPcs ? `= ${formatQty(moqPcs)} pcs. Leave blank for no MOQ.` : "Minimum order quantity. Leave blank for no MOQ."}>
              <Input id="product-moq" autoFocus inputMode="decimal" value={value} invalid={!!error} placeholder="No MOQ"
                     aria-describedby={error ? "product-moq-error" : undefined}
                     onChange={(e) => setValue(e.target.value)} className="w-full" />
            </Field>
          </div>
        </form>
      </div>
    </Sheet>
  );
}

// Side panel for a product's open Commodity Type conflicts: an upload had a different Commodity Type than the
// product. Each is resolved by keeping the recorded value or using the uploaded one.
function ConflictsPanel({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [conflicts, setConflicts] = useState(product.open_conflicts);
  const [current, setCurrent] = useState(product.commodity_type);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(c: ProductConflict, resolution: "kept_existing" | "accepted_incoming") {
    setBusy(c.id);
    setError(null);
    try {
      const res = await api.post<{ data: Product }>(`/api/product_conflicts/${c.id}/resolve`, { resolution });
      notify(resolution === "accepted_incoming"
        ? `${product.part_number}: Commodity Type changed to ${c.incoming_commodity_type}.`
        : `${product.part_number}: kept Commodity Type ${c.existing_commodity_type ?? "(blank)"}.`);
      setConflicts(res.data.open_conflicts);
      setCurrent(res.data.commodity_type);
      onSaved();
      if (res.data.open_conflicts.length === 0) onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve the conflict.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Commodity Type conflicts" icon={<PencilIcon size={18} />}
           description={<>Part <span className="font-medium text-ink">{product.part_number}</span> · recorded Commodity Type{" "}
             <span className="font-medium text-ink">{current ?? "—"}</span></>}>
      <div className="space-y-4 text-left">
        {error && <Alert>{error}</Alert>}
        {conflicts.length === 0 ? (
          <p className="text-sm text-ink-muted">No open conflicts.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-line bg-white shadow-card">
            {conflicts.map((c) => (
              <li key={c.id} className="space-y-3 px-5 py-4 text-sm">
                <p className="text-ink">
                  The upload{c.uploaded_at ? ` of ${formatDateTime(c.uploaded_at)}` : ""} has Commodity Type{" "}
                  <span className="font-semibold">{c.incoming_commodity_type}</span>; the product has{" "}
                  <span className="font-semibold">{c.existing_commodity_type ?? "none"}</span>.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy !== null} onClick={() => resolve(c, "kept_existing")}>
                    Keep {c.existing_commodity_type ?? "blank"}
                  </Button>
                  <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => resolve(c, "accepted_incoming")}>
                    {busy === c.id ? "Saving…" : `Use ${c.incoming_commodity_type}`}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
