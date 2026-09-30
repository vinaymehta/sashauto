"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { Paginated, Product, ProductConflict } from "@/lib/types";
import { formatCount, formatDateOnly, formatDateTime } from "@/lib/format";
import { UploadIcon } from "@/components/icons";
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
import { Pagination, Table, Td } from "@/components/ui/table";

const FILTERS: FilterGroup[] = [
  { key: "conflicts", label: "Commodity conflicts", options: [{ value: "open", label: "Has open conflicts" }] },
  { key: "source", label: "Source", options: [{ value: "upload", label: "From uploads" }, { value: "manual", label: "Added manually" }] },
];

export default function ProductsPage() {
  return (
    <Suspense fallback={<PanelSkeleton rows={10} columns={4} />}>
      <ProductsView />
    </Suspense>
  );
}

// Read-only list. Products are created automatically from uploads; nothing can be edited here.
function ProductsView() {
  const params = useSearchParams(); // deep link from the dashboard / bell: /products?conflicts=open
  const list = useListQuery(params.get("conflicts") === "open" ? { conflicts: "open" } : {}, 10, { key: "part_number", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());

  const { data, error, loading } = useApi<Paginated<Product>>("/api/products", {
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
                <col className="w-[28%]" />
                <col className="w-[34%]" />
                <col className="w-[18%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr>
                  <SortTh label="Part Number" sortKey="part_number" {...sortProps} />
                  <SortTh label="Commodity Type" sortKey="commodity_type" {...sortProps} />
                  <SortTh label="Source" sortKey="source" align="center" {...sortProps} />
                  <SortTh label="Last Updated" sortKey="updated_at" align="right" {...sortProps} />
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => <ProductRow key={p.id} product={p} />)}
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

function ProductRow({ product }: { product: Product }) {
  const conflicts = product.open_conflicts;
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
      <Td align="center">
        <span className="inline-flex items-center gap-1.5 rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-800">
          {product.source === "upload" && <UploadIcon size={12} className="text-neutral-500" />}
          {product.source === "manual" ? "Manual" : "Upload"}
        </span>
      </Td>
      <Td align="right">
        <time dateTime={product.updated_at} title={formatDateTime(product.updated_at)}
              className="font-mono text-xs tracking-tight text-neutral-500">
          {formatDateOnly(product.updated_at)}
        </time>
      </Td>
    </tr>
  );
}
