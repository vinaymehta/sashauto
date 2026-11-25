"use client";

import { can } from "@/lib/permissions";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { Paginated, Product, VendorImportResult } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { formatAmount, formatCustomer, formatMoq } from "@/components/vendors/price-format";
import { ProductPanel } from "@/components/products/product-panel";
import { AddPartPanel } from "@/components/products/add-part-panel";
import { PartThumbnail } from "@/components/products/part-thumbnail";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { DtpImportButton } from "@/components/vendors/dtp-import";
import { ImportIssuesPanel, useOpenImportIssues } from "@/components/vendors/import-issues";
import { AvailablePartsPanel } from "@/components/products/available-parts";
import { OrderSummaryPanel } from "@/components/products/order-summary";
import { RelatedLink } from "@/components/orders/related-popover";
import { ProductTotalsPanel } from "@/components/products/product-totals";
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
import { ColumnsMenu } from "@/components/ui/columns-menu";
import { useTableColumns, type ColumnDef } from "@/components/use-table-columns";
import { ExportButton, fetchAllRows } from "@/components/ui/export-button";

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

// The columns of the Products table (Columns chooses and orders them per user); Actions (admins) is always last.
const PRODUCT_COLUMNS: ColumnDef[] = [
  { key: "part_number", label: "Part Number", sort: "part_number" },
  { key: "description", label: "Description", sort: "description" },
  { key: "sash_part", label: "SASH Part", sort: "sash_part" },
  { key: "moq", label: "MOQ", sort: "moq", align: "right" },
  { key: "customer_price", label: "Customer / pc", align: "right" },
  { key: "best_vendor", label: "Best vendor / pc", align: "right" },
  { key: "vendors", label: "Vendors", align: "center" },
];

// The tabs of the Products page.
const PRODUCTS_TABS = ["list", "available", "totals", "summary", "issues"] as const;
type ProductsTab = (typeof PRODUCTS_TABS)[number];

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
  const columns = useTableColumns("products", PRODUCT_COLUMNS);
  const sortProps = { sort: list.sort, direction: list.direction, onSort: list.toggleSort };
  const [viewing, setViewing] = useState<{ product: Product; edit: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  // The list, the Current inventory tab (vendor-wise check list), the Product summary tab (each part's ordered,
  // dispatched, delivered, pending and revenue), the Order summary tab (Firm / Addition / Forecast per part and day) or
  // the Import issues tab (problems from vendor file imports).
  const tabParam = params.get("tab");
  // The Warehouse Manager does not see the Product summary tab.
  const noTotals = useSession().user?.role === "warehouse_manager";
  const [view, setView] = useState<ProductsTab>(PRODUCTS_TABS.find((t) => t === tabParam && !(noTotals && t === "totals")) ?? "list");
  // Every tab but the list is kept in the address (?tab=totals …), so it stays open when DTP / GMBH is switched (the
  // page is shown anew).
  const router = useRouter();
  const openView = (next: ProductsTab) => {
    setView(next);
    if (next !== (tabParam ?? "list")) router.replace(next === "list" ? "/products" : `/products?tab=${next}`, { scroll: false });
  };
  const issues = useOpenImportIssues();
  const onImported = (r: VendorImportResult) => { reload(); issues.reload(); if (r.issues) openView("issues"); };

  return (
    <>
      <PageHeader
        title="Products"
        actions={isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <DtpImportButton onImported={onImported} onDetailsImported={(n) => { issues.reload(); if (n) openView("issues"); }} />
            <Button variant="primary" onClick={() => setAdding(true)}><PlusIcon size={15} />Add part</Button>
          </div>
        )}
      />
      <div className="flex items-center border-b border-line">
        <Tabs active={view} onChange={openView} tabs={[
          { key: "list" as const, label: "Products", count: data?.meta.total ?? null },
          { key: "available" as const, label: "Current inventory" },
          ...(noTotals ? [] : [{ key: "totals" as const, label: "Product summary" }]),
          { key: "summary" as const, label: "Order summary" },
          { key: "issues" as const, label: "Import issues", count: issues.count },
        ]} />
      </div>

      {view === "issues" ? (
        <div className="mt-4"><ImportIssuesPanel canEdit={isAdmin} onChanged={() => { reload(); issues.reload(); }} /></div>
      ) : view === "available" ? (
        <div className="mt-4"><AvailablePartsPanel /></div>
      ) : view === "totals" ? (
        <div className="mt-4"><ProductTotalsPanel /></div>
      ) : view === "summary" ? (
        <div className="mt-4"><OrderSummaryPanel canEdit={isAdmin} /></div>
      ) : (
      <div className="mt-4"><Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} product${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search products" placeholder="Search part, SASH, vendor part or description" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
          <ColumnsMenu {...columns.menu} />
          <ExportButton<Product> filename="products" columns={columns.shown}
            load={() => fetchAllRows<Product>("/api/products", { q, ...list.filters, sort: list.sort, direction: list.direction })}
            value={(p, key) => {
              const best = p.best_vendor_price;
              switch (key) {
                case "part_number": return p.part_number;
                case "description": return p.description;
                case "sash_part": return p.sash_part;
                case "moq": return formatMoq(p);
                case "customer_price": return p.customer_price !== null ? formatCustomer(Number(p.customer_price) / 100, p.customer_currency) : "";
                case "best_vendor": return best ? `${perPiece(best.amount, best.currency)} ${best.vendor}` : "";
                default: return p.vendor_count;
              }
            }} />
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
            {/* Columns are the user's choice (Columns); a click on a row opens the part panel, where everything about the
                part is edited. */}
            <Table dense stickyHeader>
              <thead>
                <tr>
                  {columns.shown.map((c) => columns.head(c, c.sort
                    ? <SortTh key={c.key} label={c.label} sortKey={c.sort} align={c.align} {...sortProps} />
                    : <Th key={c.key} align={c.align}>{c.label}</Th>))}
                  {isAdmin && <Th align="right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <ProductRow key={p.id} product={p} columns={columns.shown} active={viewing?.product.id === p.id} canEdit={isAdmin}
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
function ProductRow({ product, columns, active, canEdit, onOpen }: { product: Product; columns: ColumnDef[]; active: boolean; canEdit: boolean; onOpen: (edit: boolean) => void }) {
  const best = product.best_vendor_price;
  const moq = formatMoq(product);
  const customer = product.customer_price !== null ? formatCustomer(Number(product.customer_price) / 100, product.customer_currency) : null;
  return (
    <tr onClick={() => onOpen(false)} aria-haspopup="dialog" aria-expanded={active}
        className={`cursor-pointer align-middle transition-colors duration-150 hover:bg-neutral-50 [&>td]:h-14 [&>td]:py-2 ${active ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`}>
      {columns.map((c) => {
        switch (c.key) {
          case "part_number": return (
            <Td key={c.key}>
              <span className="flex items-center gap-2 font-medium">
                <PartThumbnail imageUrl={product.images?.[0]?.url} images={product.images} alt={product.part_number} size="sm" showFallback />
                {product.part_number}
                {product.open_conflicts.length > 0 && <Badge tone="warn">Conflict</Badge>}
                {product.discontinued && <span title="No more vendor POs for this part"><Badge tone="dark">Discontinued</Badge></span>}
              </span>
            </Td>
          );
          case "description": return <Td key={c.key} className="max-w-[20rem] truncate text-ink-muted" title={product.description ?? undefined}>{product.description ?? dash}</Td>;
          case "sash_part": return <Td key={c.key}>{product.sash_part ?? dash}</Td>;
          // MOQ text from a vendor file can be long ("2000 pcs (200 of 10 pcs)"): it wraps instead of widening the table.
          case "moq": return <Td key={c.key} align="right" className="min-w-[6rem] max-w-[10rem] whitespace-normal text-sm leading-snug">{moq ?? dash}</Td>;
          case "customer_price": return <Td key={c.key} align="right" className="font-medium">{customer ?? dash}</Td>;
          case "best_vendor": return (
            <Td key={c.key} align="right" title={best ? best.vendor : undefined}>
              {best ? <>
                <span className="block font-medium text-ink">{perPiece(best.amount, best.currency)}</span>
                {/* The vendor opens its panel (parts, prices and details). */}
                <span className="ml-auto block max-w-[11rem] truncate text-xs text-ink-muted">
                  {best.vendor_id ? <RelatedLink kind="vendor" value={best.vendor} id={best.vendor_id} /> : best.vendor}
                </span>
              </> : dash}
            </Td>
          );
          default: return <Td key={c.key} align="center">{product.vendor_count ? formatCount(product.vendor_count) : dash}</Td>;
        }
      })}
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
