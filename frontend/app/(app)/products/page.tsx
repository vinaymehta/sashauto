"use client";

import { can } from "@/lib/permissions";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { Paginated, Product, VendorImportResult } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { formatAmount, formatCustomer, formatMoq } from "@/components/vendors/price-format";
import { ProductPanel } from "@/components/products/product-panel";
import { AddPartPanel } from "@/components/products/add-part-panel";
import { ImageOffIcon, PencilIcon, PlusIcon } from "@/components/icons";
import { DtpImportButton } from "@/components/vendors/dtp-import";
import { ImportIssuesPanel, useOpenImportIssues } from "@/components/vendors/import-issues";
import { AvailablePartsPanel } from "@/components/products/available-parts";
import { Tabs } from "@/components/ui/tabs";
import { useSession } from "@/components/session";
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

const SET_MISSING = [{ value: "set", label: "Set" }, { value: "missing", label: "Missing" }];

// The list filters, by section; Commodity Type lists the types in use (from the server), plus parts without one.
function productFilters(commodityTypes: string[]): FilterGroup[] {
  return [
    { section: "Part", key: "commodity_type", label: "Commodity Type",
      options: [...commodityTypes.map((v) => ({ value: v, label: v })), { value: "_none", label: "No Commodity Type" }] },
    { section: "Part", key: "pack", label: "Pack", options: [{ value: "single", label: "Single pieces" }, { value: "sets", label: "Sold in sets" }] },
    { section: "Prices and MOQ", key: "customer_price", label: "Customer price", options: SET_MISSING },
    { section: "Prices and MOQ", key: "vendor_price", label: "Vendor price", options: SET_MISSING },
    { section: "Prices and MOQ", key: "moq", label: "MOQ", options: SET_MISSING },
    { section: "Vendors", key: "vendors", label: "Vendors", options: [{ value: "none", label: "No vendor" }, { value: "one", label: "One vendor" }, { value: "many", label: "Two or more" }] },
    { section: "Vendors", key: "available", label: "Current inventory", options: [{ value: "yes", label: "In stock" }, { value: "no", label: "None in stock" }] },
    { section: "Review", key: "conflicts", label: "Commodity conflicts", options: [{ value: "open", label: "Has open conflicts" }] },
  ];
}

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
  const list = useListQuery(params.get("conflicts") === "open" ? { conflicts: "open" } : {}, 100, { key: "part_number", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());

  const isAdmin = can(useSession().user, "products", "edit"); // Products edit permission
  const { data, error, loading, reload } = useApi<Paginated<Product> & { facets?: { commodity_types: string[] }; customer_currency?: string }>("/api/products", {
    q, ...list.filters, sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });
  // Kept across reloads so the filter labels stay while the next page loads.
  const [commodityTypes, setCommodityTypes] = useState<string[]>([]);
  const types = data?.facets?.commodity_types;
  if (types && types.join() !== commodityTypes.join()) setCommodityTypes(types);
  const FILTERS = productFilters(commodityTypes);
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };
  const sortProps = { sort: list.sort, direction: list.direction, onSort: list.toggleSort };
  const [viewing, setViewing] = useState<{ product: Product; edit: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  // The list, the Current inventory tab (vendor-wise check list) or the Import issues tab (problems from vendor file imports).
  const [view, setView] = useState<"list" | "available" | "issues">("list");
  const issues = useOpenImportIssues();
  const onImported = (r: VendorImportResult) => { reload(); issues.reload(); if (r.issues) setView("issues"); };

  return (
    <>
      <PageHeader
        title="Products"
        actions={isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <DtpImportButton onImported={onImported} onDetailsImported={(n) => { issues.reload(); if (n) setView("issues"); }} />
            <Button variant="primary" onClick={() => setAdding(true)}><PlusIcon size={15} />Add part</Button>
          </div>
        )}
      />
      <div className="flex items-center border-b border-line">
        <Tabs active={view} onChange={setView} tabs={[
          { key: "list" as const, label: "Products", count: data?.meta.total ?? null },
          { key: "available" as const, label: "Current inventory" },
          { key: "issues" as const, label: "Import issues", count: issues.count },
        ]} />
      </div>

      {view === "issues" ? (
        <div className="mt-4"><ImportIssuesPanel canEdit={isAdmin} onChanged={() => { reload(); issues.reload(); }} /></div>
      ) : view === "available" ? (
        <div className="mt-4"><AvailablePartsPanel /></div>
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
            {/* Columns size to their content and Description takes the rest. On smaller screens SASH Part, Description,
                MOQ, the vendor count and (on phones) the prices drop out of the table and show under the Part Number
                instead. A row opens the part panel, where everything about the part is edited. */}
            <Table dense>
              <thead>
                <tr>
                  <SortTh label="Part Number" sortKey="part_number" {...sortProps} />
                  <SortTh label="Description" sortKey="description" className="hidden w-full xl:table-cell" {...sortProps} />
                  <SortTh label="SASH Part" sortKey="sash_part" className="hidden 2xl:table-cell" {...sortProps} />
                  <SortTh label="MOQ" sortKey="moq" align="right" className="hidden xl:table-cell" {...sortProps} />
                  <Th align="right" className="hidden sm:table-cell">Customer / pc</Th>
                  <Th align="right" className="hidden sm:table-cell">Best vendor / pc</Th>
                  <Th align="center" className="hidden xl:table-cell">Vendors</Th>
                  {isAdmin && <Th align="right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <ProductRow key={p.id} product={p} active={viewing?.product.id === p.id} canEdit={isAdmin}
                              onOpen={(edit) => setViewing({ product: p, edit })} />
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="products" />
          </div>
        ) : null}
      </Panel></div>
      )}
      {adding && <AddPartPanel currency={data?.customer_currency ?? "USD"} onClose={() => setAdding(false)} onCreated={(p) => { setAdding(false); reload(); setViewing({ product: p, edit: false }); }} />}
      {viewing && <ProductPanel key={`${viewing.product.id}:${viewing.edit}`} productId={viewing.product.id} edit={viewing.edit} canEdit={isAdmin} onClose={() => setViewing(null)} onSaved={reload} />}
    </>
  );
}

const dash = <span className="text-neutral-300" aria-label="Not set">—</span>;
const perPiece = (value: string | null | undefined, currency: string) =>
  value === null || value === undefined ? null : formatAmount(String(value), currency);

// One part: Part Number (with a conflict tag), description, SASH part, MOQ, Deere's price per piece, the lowest vendor
// price per piece (and which vendor) and how many vendors supply it. A click opens the part panel; the pencil (admins)
// opens it in edit mode.
function ProductRow({ product, active, canEdit, onOpen }: { product: Product; active: boolean; canEdit: boolean; onOpen: (edit: boolean) => void }) {
  const best = product.best_vendor_price;
  const moq = formatMoq(product);
  const sub = "block max-w-[13rem] truncate text-xs text-ink-muted sm:max-w-[12rem] md:max-w-[16rem]";
  const customer = product.customer_price !== null ? formatCustomer(Number(product.customer_price) / 100, product.customer_currency) : null;
  return (
    <tr onClick={() => onOpen(false)} aria-haspopup="dialog" aria-expanded={active}
        className={`cursor-pointer align-middle transition-colors duration-150 hover:bg-neutral-50 [&>td]:h-14 [&>td]:py-2 ${active ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`}>
      <Td>
        <span className="flex items-center gap-2 font-medium">
          {product.images?.[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API behind the session
            <img src={product.images[0].url} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded border border-line object-cover" />
          ) : (
            <span title="No image" className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-dashed border-line bg-neutral-50 text-ink-faint">
              <ImageOffIcon size={14} />
            </span>
          )}
          {product.part_number}
          {product.open_conflicts.length > 0 && <Badge tone="warn">Conflict</Badge>}
        </span>
        {/* Shown here when their own columns are hidden. */}
        {product.description && <span className={`${sub} xl:hidden`} title={product.description}>{product.description}</span>}
        {product.sash_part && <span className={`${sub} 2xl:hidden`}>SASH {product.sash_part}</span>}
        {moq && <span className={`${sub} xl:hidden`}>MOQ {moq}</span>}
        {(customer || best) && (
          <span className={`${sub} sm:hidden`}>
            {customer && `Customer ${customer} / pc`}{customer && best && " · "}{best && `Best ${perPiece(best.amount, best.currency)} ${best.vendor}`}
          </span>
        )}
      </Td>
      <Td className="hidden max-w-0 truncate text-ink-muted xl:table-cell" title={product.description ?? undefined}>{product.description ?? dash}</Td>
      <Td className="hidden 2xl:table-cell">{product.sash_part ?? dash}</Td>
      {/* MOQ text from a vendor file can be long ("2000 pcs (200 of 10 pcs)"): it wraps instead of widening the table. */}
      <Td align="right" className="hidden min-w-[6rem] max-w-[10rem] whitespace-normal text-sm leading-snug xl:table-cell">{moq ?? dash}</Td>
      <Td align="right" className="hidden font-medium sm:table-cell">{customer ?? dash}</Td>
      <Td align="right" className="hidden sm:table-cell" title={best ? best.vendor : undefined}>
        {best ? <>
          <span className="block font-medium text-ink">{perPiece(best.amount, best.currency)}</span>
          <span className="ml-auto block max-w-[9rem] truncate text-xs text-ink-muted md:max-w-[11rem]">{best.vendor}</span>
        </> : dash}
      </Td>
      <Td align="center" className="hidden xl:table-cell">{product.vendor_count ? formatCount(product.vendor_count) : dash}</Td>
      {canEdit && (
        <Td align="right">
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(true); }} title={`Edit ${product.part_number}`}
                  aria-label={`Edit ${product.part_number}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-neutral-100 hover:text-ink">
            <PencilIcon size={15} />
          </button>
        </Td>
      )}
    </tr>
  );
}
