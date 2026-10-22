"use client";

import { useState } from "react";
import type { Paginated, Vendor, VendorImportResult } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { useSession } from "@/components/session";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { DtpImportButton } from "@/components/vendors/dtp-import";
import { ImportIssuesPanel, useOpenImportIssues } from "@/components/vendors/import-issues";
import { Tabs } from "@/components/ui/tabs";
import { VendorFormPanel } from "@/components/vendors/vendor-form-panel";
import { VendorPanel } from "@/components/vendors/vendor-panel";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { FilterChips, FilterMenu, type FilterGroup } from "@/components/ui/filter-menu";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader, Panel } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td, Th } from "@/components/ui/table";

const dash = <span className="text-neutral-300">—</span>;

// The list filters, by section; Place of supply lists the places in use (from the server).
function vendorFilters(places: string[]): FilterGroup[] {
  return [
    { section: "Parts", key: "parts", label: "Parts", options: [{ value: "some", label: "Has parts" }, { value: "none", label: "No parts" }] },
    { section: "Parts", key: "available", label: "Current inventory", options: [{ value: "yes", label: "Has current inventory" }, { value: "no", label: "None in stock" }] },
    { section: "Details", key: "place_of_supply", label: "Place of supply", options: places.map((v) => ({ value: v, label: v })) },
    { section: "Details", key: "missing", label: "Missing details", options: [
      { value: "contact", label: "No phone or mobile" }, { value: "email", label: "No email" }, { value: "gst", label: "No GST" }, { value: "place", label: "No place of supply" },
    ] },
  ];
}
const iconButton = "inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink";

// Vendors and the parts they supply. Click a vendor to see its parts in the side panel.
// Admins can add and edit vendors (vendors are not deleted), manage their parts and import the vendor Excel file.
export default function VendorsPage() {
  const isAdmin = useSession().user?.role === "admin";
  const list = useListQuery({}, 100, { key: "name", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<Paginated<Vendor> & { facets?: { places_of_supply: string[] } }>("/api/vendors", {
    q, ...list.filters, sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });
  const sortProps = { sort: list.sort, direction: list.direction, onSort: list.toggleSort };
  // Kept across reloads so the filter labels stay while the next page loads.
  const [places, setPlaces] = useState<string[]>([]);
  const nextPlaces = data?.facets?.places_of_supply;
  if (nextPlaces && nextPlaces.join() !== places.join()) setPlaces(nextPlaces);
  const filters = vendorFilters(places);
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);
  const clearAll = () => { list.clearFilters(); setSearch(""); };

  const [open, setOpen] = useState<Vendor | null>(null);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  // The list, or the Import issues tab (problems from vendor file imports).
  const [view, setView] = useState<"list" | "issues">("list");
  const issues = useOpenImportIssues();
  const onImported = (r: VendorImportResult) => { reload(); issues.reload(); if (r.issues) setView("issues"); };

  return (
    <>
      <PageHeader
        title="Vendors"
        actions={isAdmin && (
          <div className="flex items-center gap-2">
            <DtpImportButton onImported={onImported} onDetailsImported={(n) => { reload(); issues.reload(); if (n) setView("issues"); }} />
            <Button variant="primary" onClick={() => setEditing("new")}><PlusIcon size={15} />Add vendor</Button>
          </div>
        )}
      />

      <div className="flex items-center border-b border-line">
        <Tabs active={view} onChange={setView} tabs={[
          { key: "list" as const, label: "Vendors", count: data?.meta.total ?? null },
          { key: "issues" as const, label: "Import issues", count: issues.count },
        ]} />
      </div>

      {view === "issues" ? (
        <div className="mt-4"><ImportIssuesPanel canEdit={isAdmin} onChanged={() => { reload(); issues.reload(); }} /></div>
      ) : (
      <div className="mt-4"><Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} vendor${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search vendors" placeholder="Search vendor or part number" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          <FilterMenu groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={filters} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        {error ? (
          <div className="p-4"><Alert title="Could not load vendors">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={3} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No vendors match" : "No vendors yet"}
            description={filtered ? "Try a different search or clear the filters." : isAdmin ? "Add a vendor or import the vendor Excel file." : "Vendors appear here once an admin adds them."}
            action={filtered ? <Button size="sm" onClick={clearAll}>Clear search and filters</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            {/* The list shows who the vendor is; everything else is in its panel. Columns size to their content and the
                name takes the rest. On smaller screens Contact No, Place of Supply, Current Inventory and Code drop out of
                the table; code, phone and place then show under the name. Some phone fields hold names and notes, so the
                number is cut with "…" (full text on hover). */}
            <Table dense>
              <thead>
                <tr>
                  <SortTh label="Vendor Name" sortKey="name" className="w-full" {...sortProps} />
                  <Th className="hidden sm:table-cell">Code</Th>
                  <Th className="hidden 2xl:table-cell">Contact No</Th>
                  <Th className="hidden xl:table-cell">Place of Supply</Th>
                  <SortTh label="Products" sortKey="product_count" align="center" {...sortProps} />
                  <SortTh label="Current Inventory" sortKey="available_count" align="center" className="hidden md:table-cell" {...sortProps} />
                  {isAdmin && <Th align="right" className="hidden sm:table-cell">Action</Th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((v) => {
                  const phone = v.phone ?? v.mobile;
                  const sub = "block truncate text-xs text-ink-muted";
                  return (
                    <tr key={v.id} onClick={() => setOpen(v)} aria-haspopup="dialog"
                        className={`cursor-pointer transition-colors hover:bg-neutral-50 [&>td]:h-14 [&>td]:py-2 ${open?.id === v.id ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`}>
                      <Td className="max-w-0" title={v.name}>
                        <span className="block truncate font-medium">{v.name}</span>
                        {/* Shown here when their own columns are hidden. */}
                        {v.code && <span className={`${sub} sm:hidden`}>{v.code}</span>}
                        {(phone || v.place_of_supply) && (
                          <span className={`${sub} 2xl:hidden`} title={phone ?? undefined}>
                            {phone}
                            {v.place_of_supply && <span className="xl:hidden">{phone ? " · " : ""}{v.place_of_supply}</span>}
                          </span>
                        )}
                      </Td>
                      <Td className="hidden font-semibold text-ink-muted sm:table-cell">{v.code ?? dash}</Td>
                      <Td className="tabular hidden max-w-[12rem] truncate text-ink-muted 2xl:table-cell" title={phone ?? undefined}>{phone ?? dash}</Td>
                      <Td className="hidden text-ink-muted xl:table-cell">{v.place_of_supply ?? dash}</Td>
                      <Td align="center" className="tabular">{formatCount(v.product_count)}</Td>
                      <Td align="center" className="tabular hidden md:table-cell" title={`${formatCount(v.available_count)} of ${formatCount(v.product_count)} parts have Current Inventory`}>
                        {v.available_count ? <span className="font-semibold text-inc">{formatCount(v.available_count)}</span> : dash}
                      </Td>
                      {isAdmin && (
                        <Td align="right" className="hidden space-x-1 sm:table-cell" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className={iconButton} onClick={() => setEditing(v)} aria-label={`Edit ${v.name}`} title="Edit vendor">
                            <PencilIcon size={16} />
                          </button>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="vendors" />
          </div>
        ) : null}
      </Panel></div>
      )}

      {open && <VendorPanel key={open.id} vendor={open} canEdit={isAdmin} onClose={() => setOpen(null)} onChanged={reload}
                            onEdit={() => { setEditing(open); setOpen(null); }} />}
      {editing && (
        <VendorFormPanel vendor={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}
                         onSaved={(v) => { reload(); if (open?.id === v.id) setOpen({ ...open, name: v.name }); }} />
      )}
    </>
  );
}
