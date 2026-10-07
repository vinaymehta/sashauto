"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Paginated, User } from "@/lib/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { ResetPasswordPanel, ROLE_LABEL, UserFormPanel } from "@/components/users/user-form-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { FilterChips, FilterMenu, type FilterGroup } from "@/components/ui/filter-menu";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader, Panel } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { SortTh } from "@/components/ui/sort-header";
import { Pagination, Table, Td, Th } from "@/components/ui/table";

const iconButton = "inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink";

const FILTERS: FilterGroup[] = [
  { key: "role", label: "Role", options: [{ value: "admin", label: "Admin" }, { value: "warehouse_manager", label: "Warehouse Manager" }] },
  { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
];

// User accounts (admins only): add users, edit name/email/role, reset passwords, deactivate and reactivate.
// Users are never deleted; a deactivated user cannot sign in and is signed out.
export default function UsersPage() {
  const { user: me } = useSession();
  const isAdmin = me?.role === "admin";
  const notify = useToast();
  const list = useListQuery({}, 25, { key: "name", direction: "asc" });
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<Paginated<User>>(isAdmin ? "/api/users" : null, {
    q, ...list.filters, sort: list.sort, direction: list.direction, page: list.page, per_page: list.perPage,
  });
  const sortProps = { sort: list.sort, direction: list.direction, onSort: list.toggleSort };
  const filtered = q !== "" || Object.values(list.filters).some(Boolean);

  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [toggling, setToggling] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggleActive() {
    if (!toggling) return;
    setBusy(true);
    setToggleError(null);
    try {
      await api.patch(`/api/users/${toggling.id}`, { active: !toggling.active });
      notify(toggling.active ? `${toggling.name} deactivated.` : `${toggling.name} reactivated.`);
      setToggling(null);
      reload();
    } catch (err) {
      setToggleError(err instanceof ApiError ? err.message : "Could not change the user.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Users" />
        <Alert tone="info" title="Only admins can manage users">Ask an admin to add or change user accounts.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, and with which role. New users get their sign-in details by email."
        actions={<Button variant="primary" onClick={() => setEditing("new")}><PlusIcon size={15} />Add user</Button>}
      />

      <Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} user${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search users" placeholder="Search name or email" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          <FilterMenu groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        </ListToolbar>
        <FilterChips groups={FILTERS} values={list.filters} onChange={list.setFilter} onClear={list.clearFilters} />
        {error ? (
          <div className="p-4"><Alert title="Could not load users">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={6} columns={6} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            title={filtered ? "No users match" : "No users yet"}
            description={filtered ? "Try a different search or clear the filters." : "Add the first user."}
            action={filtered ? <Button size="sm" onClick={() => { setSearch(""); list.clearFilters(); }}>Clear search and filters</Button> : undefined}
          />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
            <Table>
              <thead>
                <tr>
                  <SortTh label="Name" sortKey="name" {...sortProps} />
                  <SortTh label="Email" sortKey="email" {...sortProps} />
                  <SortTh label="Role" sortKey="role" {...sortProps} />
                  <Th>Status</Th>
                  <SortTh label="Last sign-in" sortKey="last_login_at" {...sortProps} />
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className={u.active ? "" : "text-ink-muted"}>
                      <Td className="font-medium">
                        <span className="inline-flex items-center gap-2">{u.name}{self && <Badge>You</Badge>}</span>
                      </Td>
                      <Td>{u.email}</Td>
                      <Td>{u.role === "admin" ? <Badge tone="dark">{ROLE_LABEL[u.role]}</Badge> : ROLE_LABEL[u.role]}</Td>
                      <Td>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {u.active ? <Badge tone="up">Active</Badge> : <Badge>Inactive</Badge>}
                          {u.active && u.must_change_password && <Badge tone="warn">Password not set yet</Badge>}
                        </span>
                      </Td>
                      <Td className="tabular">{u.last_login_at ? formatDateTime(u.last_login_at) : <span className="text-ink-faint">Never</span>}</Td>
                      <Td align="right">
                        <button type="button" className={iconButton} onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`} title="Edit user">
                          <PencilIcon size={16} />
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="users" />
          </div>
        ) : null}
      </Panel>

      {editing && (
        <UserFormPanel user={editing === "new" ? undefined : editing} isSelf={editing !== "new" && editing.id === me?.id}
                       onClose={() => setEditing(null)} onSaved={reload}
                       onResetPassword={() => { if (editing !== "new") { setResetting(editing); setEditing(null); } }}
                       onToggleActive={() => { if (editing !== "new") { setToggleError(null); setToggling(editing); setEditing(null); } }} />
      )}
      {resetting && <ResetPasswordPanel user={resetting} onClose={() => setResetting(null)} onSaved={reload} />}
      {toggling && (
        <ConfirmDialog
          title={toggling.active ? `Deactivate ${toggling.name}?` : `Reactivate ${toggling.name}?`}
          confirmLabel={toggling.active ? "Deactivate" : "Reactivate"} busyLabel="Saving…"
          tone={toggling.active ? "danger" : "primary"} busy={busy} error={toggleError}
          onConfirm={toggleActive} onCancel={() => setToggling(null)}
        >
          {toggling.active
            ? "They can no longer sign in and are signed out now. Their uploads, orders and history stay."
            : "They can sign in again with their current password."}
        </ConfirmDialog>
      )}
    </>
  );
}
