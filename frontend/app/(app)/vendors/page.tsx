"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Paginated, Vendor, VendorImportResult } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { EyeIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { DtpImportButton } from "@/components/vendors/dtp-import";
import { ImportIssuesPanel, useOpenImportIssues } from "@/components/vendors/import-issues";
import { Tabs } from "@/components/ui/tabs";
import { VendorDetailsPanel } from "@/components/vendors/vendor-details-panel";
import { VendorFormPanel } from "@/components/vendors/vendor-form-panel";
import { VendorProductsPanel } from "@/components/vendors/vendor-products-panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader, Panel } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td, Th } from "@/components/ui/table";

const dash = <span className="text-neutral-300">—</span>;
const iconButton = "inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink";

// Vendors and the parts they supply. Click a vendor to see its parts in the side panel.
// Admins can add, rename and delete vendors, manage their parts and import the vendor Excel file.
export default function VendorsPage() {
  const isAdmin = useSession().user?.role === "admin";
  const notify = useToast();
  const list = useListQuery({}, 25, { key: "name", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<Paginated<Vendor>>("/api/vendors", {
    q, sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });
  const sortProps = { sort: list.sort, direction: list.direction, onSort: list.toggleSort };

  const [open, setOpen] = useState<Vendor | null>(null);
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const [viewing, setViewing] = useState<Vendor | null>(null); // the details panel
  const [deleting, setDeleting] = useState<Vendor | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The list, or the Import issues tab (problems from vendor file imports).
  const [view, setView] = useState<"list" | "issues">("list");
  const issues = useOpenImportIssues();
  const onImported = (r: VendorImportResult) => { reload(); issues.reload(); if (r.issues) setView("issues"); };

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.delete(`/api/vendors/${deleting.id}`);
      notify(`Vendor ${deleting.name} deleted.`);
      setDeleting(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete the vendor.");
    } finally {
      setBusy(false);
    }
  }

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
        </ListToolbar>
        {error ? (
          <div className="p-4"><Alert title="Could not load vendors">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={10} columns={3} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={q ? "No vendors match" : "No vendors yet"}
            description={q ? "Try a different search." : isAdmin ? "Add a vendor or import the vendor Excel file." : "Vendors appear here once an admin adds them."}
            action={q ? <Button size="sm" onClick={() => setSearch("")}>Clear search</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            {/* The list shows who the vendor is; everything else is in its details panel (View). */}
            {/* Columns share the width in proportion to their content, so the gaps between them stay even on any screen;
                the table scrolls sideways below 1180px. Action fits the View, Edit and Delete icons in one line. */}
            <Table fixed minWidth="min-w-[1180px]">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[9%]" />
                <col className="w-[19%]" />
                <col className="w-[14%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr>
                  <SortTh label="Vendor Name" sortKey="name" {...sortProps} />
                  <Th>Code</Th>
                  <Th>Contact No</Th>
                  <Th>Place of Supply</Th>
                  <SortTh label="Products" sortKey="product_count" align="center" {...sortProps} />
                  <SortTh label="Available Parts" sortKey="available_count" align="center" {...sortProps} />
                  <Th align="center">Action</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((v) => (
                  <tr key={v.id} onClick={() => setOpen(v)} aria-haspopup="dialog"
                      className={`cursor-pointer transition-colors hover:bg-neutral-50 ${open?.id === v.id ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`}>
                    <Td className="truncate font-medium" title={v.name}>{v.name}</Td>
                    <Td className="truncate font-semibold text-ink-muted">{v.code ?? dash}</Td>
                    <Td className="truncate tabular text-ink-muted" title={v.phone ?? v.mobile ?? undefined}>{v.phone ?? v.mobile ?? dash}</Td>
                    <Td className="truncate text-ink-muted">{v.place_of_supply ?? dash}</Td>
                    <Td align="center" className="tabular">{formatCount(v.product_count)}</Td>
                    <Td align="center" className="tabular" title={`${formatCount(v.available_count)} of ${formatCount(v.product_count)} parts have Available Parts`}>
                      {v.available_count ? <span className="font-semibold text-inc">{formatCount(v.available_count)}</span> : dash}
                    </Td>
                    <Td align="center" className="space-x-1" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className={iconButton} onClick={() => setViewing(v)} aria-label={`View ${v.name}`} title="View vendor details">
                        <EyeIcon size={16} />
                      </button>
                      {isAdmin && (<>
                        <button type="button" className={iconButton} onClick={() => setEditing(v)} aria-label={`Edit ${v.name}`} title="Edit vendor">
                          <PencilIcon size={16} />
                        </button>
                        <button type="button" className={`${iconButton} hover:text-dec`} onClick={() => { setDeleteError(null); setDeleting(v); }}
                                aria-label={`Delete ${v.name}`} title="Delete vendor">
                          <TrashIcon size={16} />
                        </button>
                      </>)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="vendors" />
          </div>
        ) : null}
      </Panel></div>
      )}

      {open && <VendorProductsPanel key={open.id} vendor={open} canEdit={isAdmin} onClose={() => setOpen(null)} onChanged={reload} />}
      {viewing && (
        <VendorDetailsPanel vendor={viewing} onClose={() => setViewing(null)}
                            onEdit={isAdmin ? () => { setEditing(viewing); setViewing(null); } : undefined} />
      )}
      {editing && (
        <VendorFormPanel vendor={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}
                         onSaved={(v) => { reload(); if (open?.id === v.id) setOpen({ ...open, name: v.name }); }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.name}?`} busy={busy} error={deleteError} onConfirm={remove} onCancel={() => setDeleting(null)}>
          This removes the vendor and its list of {formatCount(deleting.product_count)} part{deleting.product_count === 1 ? "" : "s"}. The products themselves stay in Products.
        </ConfirmDialog>
      )}
    </>
  );
}
