"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Paginated, Vendor, VendorImportResult } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { DtpImportButton, DtpImportSkipped } from "@/components/vendors/dtp-import";
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
  const [deleting, setDeleting] = useState<Vendor | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<VendorImportResult | null>(null);

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
            <DtpImportButton onImported={(r) => { setImportResult(r); reload(); }} />
            <Button variant="primary" onClick={() => setEditing("new")}><PlusIcon size={15} />Add vendor</Button>
          </div>
        )}
      />

      <DtpImportSkipped result={importResult} />

      <Panel flush>
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
            <Table fixed>
              <colgroup>
                <col className={isAdmin ? "w-1/3" : "w-1/2"} />
                <col className={isAdmin ? "w-1/3" : "w-1/2"} />
                {isAdmin && <col className="w-1/3" />}
              </colgroup>
              <thead>
                <tr>
                  <SortTh label="Vendor Name" sortKey="name" {...sortProps} />
                  <SortTh label="Products" sortKey="product_count" align="center" {...sortProps} />
                  {isAdmin && <Th align="center">Action</Th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((v) => (
                  <tr key={v.id} onClick={() => setOpen(v)} aria-haspopup="dialog"
                      className={`cursor-pointer transition-colors hover:bg-neutral-50 ${open?.id === v.id ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""}`}>
                    <Td className="truncate font-medium" title={v.name}>{v.name}</Td>
                    <Td align="center" className="tabular">{formatCount(v.product_count)}</Td>
                    {isAdmin && (
                      <Td align="center" className="space-x-1" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className={iconButton} onClick={() => setEditing(v)} aria-label={`Edit ${v.name}`} title="Edit vendor">
                          <PencilIcon size={16} />
                        </button>
                        <button type="button" className={`${iconButton} hover:text-dec`} onClick={() => { setDeleteError(null); setDeleting(v); }}
                                aria-label={`Delete ${v.name}`} title="Delete vendor">
                          <TrashIcon size={16} />
                        </button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="vendors" />
          </div>
        ) : null}
      </Panel>

      {open && <VendorProductsPanel key={open.id} vendor={open} canEdit={isAdmin} onClose={() => setOpen(null)} onChanged={reload} />}
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
