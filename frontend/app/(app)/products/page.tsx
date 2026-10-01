"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Paginated, Product, ProductConflict } from "@/lib/types";
import { formatCount, formatDateOnly, formatDateTime, formatQty } from "@/lib/format";
import { PencilIcon } from "@/components/icons";
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
import { Alert, EmptyState } from "@/components/ui/feedback";
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
    <Suspense fallback={<PanelSkeleton rows={10} columns={4} />}>
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

  return (
    <>
      <PageHeader title="Products" description="Every Part Number found in the uploaded files, with its Commodity Type." />

      <Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} product${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search products" placeholder="Search part number or commodity type" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        {error ? (
          <div className="p-4"><Alert title="Could not load products">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={4} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No products match" : "No products yet"}
            description={filtered ? "Try a different search or clear the filter." : "Products appear automatically after the first upload."}
            action={filtered ? <Button size="sm" onClick={clearAll}>Clear search and filters</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            <Table fixed>
              <colgroup>
                <col className={isAdmin ? "w-[26%]" : "w-[28%]"} />
                <col className={isAdmin ? "w-[30%]" : "w-[36%]"} />
                <col className={isAdmin ? "w-[14%]" : "w-[16%]"} />
                <col className={isAdmin ? "w-[18%]" : "w-[20%]"} />
                {isAdmin && <col className="w-[12%]" />}
              </colgroup>
              <thead>
                <tr>
                  <SortTh label="Part Number" sortKey="part_number" {...sortProps} />
                  <SortTh label="Commodity Type" sortKey="commodity_type" {...sortProps} />
                  <SortTh label="MOQ" sortKey="moq" align="right" {...sortProps} />
                  <SortTh label="Last Updated" sortKey="updated_at" align="right" {...sortProps} />
                  {isAdmin && <Th align="center">Action</Th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => <ProductRow key={p.id} product={p} canEdit={isAdmin} onSaved={reload} />)}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="products" />
          </div>
        ) : null}
      </Panel>
    </>
  );
}

function conflictNote(c: ProductConflict) {
  const when = c.uploaded_at ? ` on ${formatDateTime(c.uploaded_at)}` : "";
  return `An upload${when} contained Commodity Type ${c.incoming_commodity_type}. The recorded value was kept.`;
}

const MOQ_FORMAT = /^\d+(\.\d{1,3})?$/;

function ProductRow({ product, canEdit, onSaved }: { product: Product; canEdit: boolean; onSaved: () => void }) {
  const conflicts = product.open_conflicts;
  const [editing, setEditing] = useState(false);

  return (
    <tr className="transition-colors duration-150 hover:bg-neutral-50/50">
      <Td className="truncate font-medium" title={product.part_number}>{product.part_number}</Td>
      <Td className="truncate">
        <span className="inline-flex max-w-full items-center gap-2">
          {product.commodity_type ?? <span className="text-neutral-300" aria-label="Not set">—</span>}
          {conflicts.length > 0 && (
            <span title={conflicts.map(conflictNote).join("\n")}>
              <Badge tone="warn">{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}</Badge>
            </span>
          )}
        </span>
      </Td>
      <Td align="right" className="tabular">
        {product.moq !== null ? formatQty(product.moq) : <span className="text-neutral-300" aria-label="Not set">—</span>}
      </Td>
      <Td align="right">
        <time dateTime={product.updated_at} title={formatDateTime(product.updated_at)}
              className="font-mono text-xs tracking-tight text-neutral-500">
          {formatDateOnly(product.updated_at)}
        </time>
      </Td>
      {canEdit && (
        <Td align="center">
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

// Side panel for editing a product's MOQ (the only editable field). Blank clears it.
function MoqPanel({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [value, setValue] = useState(product.moq ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await api.patch(`/api/products/${product.id}`, { moq: moq || null });
      notify(moq ? `MOQ for ${product.part_number} set to ${formatQty(moq)}.` : `MOQ for ${product.part_number} cleared.`);
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
      description="Order rows with a Qty below the MOQ are emailed as MOQ alerts on the next upload."
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
          <Field label="MOQ" htmlFor="product-moq" hint="Minimum order quantity. Leave blank for no MOQ." error={error} optional>
            <Input id="product-moq" autoFocus inputMode="decimal" value={value} invalid={!!error} placeholder="No MOQ"
                   aria-describedby={error ? "product-moq-error" : undefined}
                   onChange={(e) => setValue(e.target.value)} className="w-full" />
          </Field>
        </form>
      </div>
    </Sheet>
  );
}
