"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/permissions";
import { formatCount, formatDate, formatQty } from "@/lib/format";
import type { PurchaseOrderRow, PurchaseOrdersPage, VendorPoImportInfo } from "@/lib/types";
import { PurchaseIssuesPanel } from "@/components/purchases/purchase-issues";
import { Dropdown } from "@/components/orders/orders-menu";
import { Sheet } from "@/components/ui/sheet";
import { BusinessPicker, useBusiness } from "@/components/business-switch";
import { CheckIcon, ChevronDownIcon, FileIcon, TruckIcon, UploadIcon } from "@/components/icons";
import { Kpi } from "@/components/upload-summary";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { useApi, useDebounced } from "@/components/use-api";
import { useListQuery } from "@/components/use-list-query";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader, Panel } from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";

const dash = <span className="text-neutral-300">—</span>;

// Purchase orders: every vendor PO (generated with Place order, or recorded from an uploaded vendor PO list) with its
// order, Qty, Order placed and Goods received. Upload vendor PO list (Orders edit, one business): the Deere dump with
// Vendor Name, PO Qty Issued and the vendor PO number; each listed order gets that vendor PO on the Orders page.
// Nothing already recorded is overwritten; the rows skipped are shown with the reason.
export default function PurchaseOrdersPage() {
  const me = useSession().user;
  const editor = can(me, "orders", "edit"); // the client's users upload these files too
  const admin = me?.role === "admin";
  const [receipts, setReceipts] = useState<PurchaseOrderRow | null>(null);
  const { view: business } = useBusiness();
  const list = useListQuery({}, 100);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useApi<PurchaseOrdersPage>("/api/purchase_orders", {
    q, source: list.filters.source, received: list.filters.received, page: list.page, per_page: list.perPage,
  });
  const [result, setResult] = useState<VendorPoImportInfo | null>(null);
  // Rows of an upload that came again with other values: the modal to override them or keep the earlier values.
  const [conflicts, setConflicts] = useState<VendorPoImportInfo | null>(null);
  const uploaded = (r: VendorPoImportInfo) => { setResult(r); if (r.conflicts.some((c) => c.status === "open")) setConflicts(r); reload(); };
  // Tabs, as on Products and Vendors: the vendor POs, and the rows of uploaded files that were not recorded.
  const [view, setView] = useState<"list" | "issues">("list");

  return (
    <>
      <PageHeader title="Purchase orders" description="Vendor POs placed for Deere orders (generated here, or uploaded as a vendor PO list) and what the vendors delivered."
                  actions={<div className="flex flex-wrap items-center gap-2"><BusinessPicker />{editor && <UploadMenu business={business} onDone={uploaded} />}</div>} />
      <div className="mb-5 flex items-center border-b border-line">
        <Tabs active={view} onChange={setView} tabs={[
          { key: "list" as const, label: "Vendor POs", count: data?.counts.total ?? null },
          { key: "issues" as const, label: "Import issues", count: data?.counts.issues ?? null },
        ]} />
      </div>
      {data && view === "list" && (
        <dl className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Vendor POs" value={formatCount(data.counts.total)} hint="Generated here and from uploaded lists" icon={<FileIcon size={16} />}
               tint="violet" onClick={() => { list.clearFilters(); setSearch(""); }} />
          <Kpi label="From uploaded lists" value={formatCount(data.counts.file)} hint="Recorded from vendor PO lists" icon={<UploadIcon size={16} />}
               tint="aqua" onClick={() => list.setFilter("source", "file")} />
          <Kpi label="Generated here" value={formatCount(data.counts.app)} hint="With Place order on the Orders page" icon={<TruckIcon size={16} />}
               tint="amber" onClick={() => list.setFilter("source", "app")} />
          <Kpi label="Goods not received in full" value={formatCount(data.counts.awaiting)} hint="Vendor material still to come to SASH Faridabad" icon={<CheckIcon size={16} />}
               tint="dec" onClick={() => list.setFilter("received", "no")} />
        </dl>
      )}
      {result && <ImportResult result={result} onClose={() => setResult(null)} onReview={() => setConflicts(result)} />}
      {conflicts && <ConflictsModal upload={conflicts} onClose={() => setConflicts(null)} onDone={(r) => { setResult(r); setConflicts(null); reload(); }} />}
      {view === "issues" ? <PurchaseIssuesPanel canEdit={editor} onChanged={reload} /> : <Panel flush>
        <ListToolbar summary={data ? `${formatCount(data.meta.total)} vendor PO${data.meta.total === 1 ? "" : "s"}` : ""}>
          <SearchInput label="Search purchase orders" placeholder="Search PO, vendor, Deere PO or part" value={search}
                       onSearch={(v) => { setSearch(v); list.resetPage(); }} className="w-full sm:w-72" />
          <Select aria-label="Source" value={list.filters.source ?? ""} onChange={(e) => list.setFilter("source", e.target.value)} className="h-9 w-40 text-sm">
            <option value="">All sources</option>
            <option value="app">Generated here</option>
            <option value="file">From uploaded list</option>
          </Select>
          <Select aria-label="Goods received" value={list.filters.received ?? ""} onChange={(e) => list.setFilter("received", e.target.value)} className="h-9 w-44 text-sm">
            <option value="">Goods: all</option>
            <option value="no">Not received in full</option>
            <option value="yes">Received in full</option>
          </Select>
        </ListToolbar>
        {error ? (
          <div className="p-4"><Alert title="Could not load the purchase orders">{error.message}</Alert></div>
        ) : loading && !data ? (
          <TableSkeleton rows={8} columns={9} />
        ) : data && data.data.length === 0 ? (
          <EmptyState title={q || list.filters.source || list.filters.received ? "No purchase orders match" : "No purchase orders yet"}
                      description={q ? "Try a different search." : "Generate POs with Place order on the Orders page, or upload a vendor PO list."} />
        ) : data && (<>
          <Table minWidth="min-w-[960px]">
            <thead>
              <tr>
                <Th>Vendor PO</Th><Th>Vendor</Th><Th>Order</Th><Th title="The day SASH received the Deere order (Firm Date)">Order date</Th><Th align="right">Qty</Th><Th>Received</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => <Row key={row.id} row={row} editor={editor} onReceipts={() => setReceipts(row)} />)}
            </tbody>
          </Table>
          <Pagination meta={data.meta} onPage={list.setPage} onPerPage={list.setPerPage} noun="vendor POs" />
        </>)}
      </Panel>}
      {receipts && <Receipts row={receipts} editor={editor} admin={admin} onClose={() => setReceipts(null)} onChanged={reload} />}
    </>
  );
}

function Row({ row, editor, onReceipts }: { row: PurchaseOrderRow; editor: boolean; onReceipts: () => void }) {
  const received = Number(row.received_qty);
  const full = received >= Number(row.qty) && received > 0;
  const last = row.receipts[row.receipts.length - 1];
  return (
    <tr className="hover:bg-subtle/60">
      <Td className="max-w-48 py-2">
        <span className="block truncate font-medium" title={row.number}>{row.number}</span>
        <span className="block truncate text-xs text-ink-muted" title={row.filename ?? undefined}>{row.source === "file" ? "Uploaded list" : "Generated here"}</span>
      </Td>
      <Td className="max-w-44 truncate" title={row.vendor_name}>{row.vendor_name}</Td>
      <Td className="py-2">
        <span className="block font-medium">{row.part_number}</span>
        <span className="block text-xs text-ink-muted">PO {row.po_number} · {row.po_line_number} · ship {formatDate(row.ship_date)}</span>
      </Td>
      {/* Order date: the day SASH received the Deere order (its first upload as Firm / Order). */}
      <Td>{row.order_date ? formatDate(row.order_date) : dash}</Td>
      <Td align="right">{formatQty(row.qty)} <span className="text-xs text-ink-muted">{row.unit}</span></Td>
      {/* Received: Qty received of the PO's Qty, the last vendor invoice and its date; the button lists or adds receipts. */}
      <Td className="py-2">
        <button type="button" onClick={onReceipts} className="group text-left" title="Receipts: date received and vendor invoice">
          <span className={`block font-medium ${full ? "text-inc" : received > 0 ? "text-tint-amber-ink" : "text-ink-muted"}`}>
            {received > 0 ? `${full ? "✓ " : ""}${formatQty(row.received_qty)} of ${formatQty(row.qty)}` : "Not received"}
          </span>
          <span className="block text-xs text-ink-muted group-hover:text-accent">
            {last ? `${formatDate(last.received_on)} · inv ${last.invoice_number}${row.receipts.length > 1 ? ` +${row.receipts.length - 1}` : ""}` : editor ? "+ Add receipt" : ""}
          </span>
        </button>
      </Td>
    </tr>
  );
}

// Receipts of one vendor PO: each delivery with its date received, vendor invoice number and Qty; editors add one by
// hand (a Purchase Received file adds them in bulk), an admin removes a wrong one.
function Receipts({ row, editor, admin, onClose, onChanged }: { row: PurchaseOrderRow; editor: boolean; admin: boolean; onClose: () => void; onChanged: () => void }) {
  const notify = useToast();
  const open = Math.max(Number(row.qty) - Number(row.received_qty), 0);
  const [form, setForm] = useState({ received_on: new Date().toISOString().slice(0, 10), invoice_number: "", qty: open ? String(open) : "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/vendor_orders/${row.id}/receipts`, form);
      notify(`Receipt of ${formatQty(form.qty)} pcs added to ${row.number}.`);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the receipt.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: number) {
    try {
      await api.delete(`/api/vendor_orders/${row.id}/receipts/${id}`);
      notify("Receipt removed.");
      onChanged();
      onClose();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not remove the receipt.", "error");
    }
  }
  const input = "h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm";
  return (
    <Sheet open onClose={onClose} title={`Received · ${row.number}`} icon={<CheckIcon size={18} />}
           description={<>{row.vendor_name} · {row.part_number} · ordered {formatQty(row.qty)} pcs, received {formatQty(row.received_qty)}</>}>
      {row.receipts.length === 0 ? <p className="mb-4 text-sm text-ink-muted">Nothing received yet.</p> : (
        <div className="mb-5 overflow-hidden rounded-lg border border-line">
          <Table dense minWidth="min-w-0">
            <thead><tr><Th>Date received</Th><Th>Vendor invoice</Th><Th align="right">Qty</Th>{admin && <Th />}</tr></thead>
            <tbody>
              {row.receipts.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDate(r.received_on)}</Td><Td>{r.invoice_number}</Td><Td align="right">{formatQty(r.qty)}</Td>
                  {admin && <Td align="right"><button type="button" onClick={() => remove(r.id)} className="text-xs font-medium text-dec hover:underline">Remove</button></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {editor && (
        <div className="space-y-3 rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold text-ink">Add receipt</h3>
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm"><span className="block font-medium">Date received</span>
              <input type="date" value={form.received_on} onChange={(e) => setForm({ ...form, received_on: e.target.value })} className={input} /></label>
            <label className="space-y-1 text-sm"><span className="block font-medium">Vendor invoice no.</span>
              <input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} className={input} placeholder="e.g. FE/26-27/00988" /></label>
            <label className="space-y-1 text-sm"><span className="block font-medium">Qty (pcs)</span>
              <input type="number" min="0" step="any" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} className={`${input} tabular`} /></label>
          </div>
          <div className="flex justify-end"><Button variant="primary" onClick={add} disabled={busy}>{busy ? "Saving…" : "Add receipt"}</Button></div>
        </div>
      )}
    </Sheet>
  );
}

// One Upload button: its menu uploads a vendor PO list ("orders") or a Purchase Received file ("received"), one .xlsx
// of the chosen business.
function UploadMenu({ business, onDone }: { business: string; onDone: (result: VendorPoImportInfo) => void }) {
  const notify = useToast();
  const inputs = { orders: useRef<HTMLInputElement>(null), received: useRef<HTMLInputElement>(null) };
  const [busy, setBusy] = useState<VendorPoImportInfo["kind"] | null>(null);
  async function upload(kind: VendorPoImportInfo["kind"], file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    const received = kind === "received";
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post<{ data: VendorPoImportInfo }>(received ? "/api/purchase_orders/import_received" : "/api/purchase_orders/import", form);
      notify(`${formatCount(data.created)} ${received ? "receipt row" : "vendor PO"}${data.created === 1 ? "" : "s"} recorded` +
             `${data.skipped.length ? `, ${formatCount(data.skipped.length)} row${data.skipped.length === 1 ? "" : "s"} skipped` : ""}.`,
             data.skipped.length ? "error" : "success");
      onDone(data);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "The upload failed.", "error");
    } finally {
      setBusy(null);
      const input = inputs[kind].current;
      if (input) input.value = "";
    }
  }
  const items: { kind: VendorPoImportInfo["kind"]; label: string; hint: string }[] = [
    { kind: "orders", label: "Vendor PO list", hint: "Deere dump with Vendor Name, PO Qty Issued and vendor PO number" },
    { kind: "received", label: "Purchase received", hint: "Vendor Invoice Date, Invoice No., Part, vendor, Quantity" },
  ];
  if (business === "all") {
    return <Button disabled title="Choose DTP or GMBH first: a file is for one business."><UploadIcon size={15} />Upload</Button>;
  }
  return (
    <>
      {items.map((i) => <input key={i.kind} ref={inputs[i.kind]} type="file" accept=".xlsx" hidden onChange={(e) => upload(i.kind, e.target.files?.[0])} />)}
      <Dropdown width="w-80" label={<span className="inline-flex items-center gap-1.5"><UploadIcon size={15} className="text-ink-muted" />{busy ? "Uploading…" : "Upload"}</span>}>
        {(close) => (
          <div className="py-1">
            {items.map((i) => (
              <button key={i.kind} type="button" role="menuitem" disabled={busy !== null}
                      onClick={() => { close(); inputs[i.kind].current?.click(); }}
                      className="flex w-full flex-col px-4 py-2.5 text-left transition-colors hover:bg-canvas disabled:opacity-50">
                <span className="text-sm font-medium text-ink">{i.label}</span>
                <span className="text-xs text-ink-muted">{i.hint}</span>
              </button>
            ))}
          </div>
        )}
      </Dropdown>
    </>
  );
}

// The result of an upload: how many vendor POs were recorded, the rows skipped by reason, and (on demand) every skipped
// row with its reason.
function ImportResult({ result, onClose, onReview }: { result: VendorPoImportInfo; onClose: () => void; onReview: () => void }) {
  const open = result.conflicts.filter((c) => c.status === "open").length;
  const [shown, setShown] = useState(false);
  const reasons = Object.entries(result.skipped.reduce<Record<string, number>>((acc, s) => {
    const r = s.reason;
    const kind = r.startsWith("vendor ") ? "Vendor not in Vendors" : r.startsWith("the order is already fully ordered") ? "Already fully ordered"
      : r.startsWith("already recorded") ? "Already recorded" : r.startsWith("a Forecast") ? "Forecast line"
      : r.startsWith("no vendor PO") ? "No vendor PO for part + vendor" : r.startsWith("everything ordered") ? "Already received in full"
      : r.includes("more than the vendor POs still had open") ? "More than ordered (rest recorded)"
      : r.startsWith("no ") && r.includes("in the order data") ? "Order not found" : "Other";
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${result.skipped.length ? "bg-tint-amber text-tint-amber-ink" : "bg-inc-bg text-inc"}`}>
          <UploadIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink" title={result.filename}>{result.filename}</p>
          <p className="text-xs text-ink-muted">
            <span className="font-semibold text-inc">{formatCount(result.created)} {result.kind === "received" ? "receipt rows" : "vendor POs"} recorded</span>
            {" · "}<span className={result.skipped.length ? "font-semibold text-dec" : ""}>{formatCount(result.skipped.length)} skipped</span>
            {" · "}{formatCount(result.rows)} rows · nothing already recorded was overwritten · open problems are on the Import issues tab
          </p>
        </div>
        {open > 0 && <Button size="sm" variant="primary" onClick={onReview}>Review {formatCount(open)} changed row{open === 1 ? "" : "s"}</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {result.skipped.length > 0 && (<>
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-subtle/50 px-4 py-2.5 sm:px-5">
          {reasons.map(([kind, n]) => (
            <span key={kind} className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-ink">
              {kind} <span className="font-semibold">{formatCount(n)}</span>
            </span>
          ))}
          <button type="button" onClick={() => setShown((o) => !o)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            {shown ? "Hide skipped rows" : "Show skipped rows"}
            <ChevronDownIcon size={13} className={shown ? "rotate-180" : ""} />
          </button>
        </div>
        {shown && (
          <div className="max-h-80 overflow-auto border-t border-line">
            <Table dense minWidth="min-w-[820px]" stickyHeader>
              <thead><tr><Th>Row</Th><Th>Deere PO</Th><Th>Part</Th><Th>Vendor</Th><Th>Vendor PO</Th><Th>Reason</Th></tr></thead>
              <tbody>
                {result.skipped.map((s) => (
                  <tr key={`${s.row}-${s.vendor_po}`}>
                    <Td className="tabular text-ink-muted">{s.row}</Td><Td>{s.po_number || dash}</Td><Td className="font-medium">{s.part_number || dash}</Td>
                    <Td className="max-w-44 truncate" title={s.vendor}>{s.vendor || dash}</Td>
                    <Td className="max-w-44 truncate" title={s.vendor_po}>{s.vendor_po || dash}</Td>
                    <Td className="whitespace-normal! text-ink-muted">{s.reason}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </>)}
    </section>
  );
}

// The rows of an upload that were uploaded before with other values (a vendor PO's number or Qty, an invoice's Qty
// received for a part): tick the ones to override with the file's values; Keep current leaves the rest as they were.
function ConflictsModal({ upload, onClose, onDone }: { upload: VendorPoImportInfo; onClose: () => void; onDone: (r: VendorPoImportInfo) => void }) {
  const notify = useToast();
  const open = upload.conflicts.filter((c) => c.status === "open");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const received = upload.kind === "received";
  async function apply(override: boolean) {
    setBusy(true);
    try {
      const ids = override ? picked : [];
      const keep = open.map((c) => c.id).filter((id) => !ids.includes(id));
      const { data } = await api.post<{ data: VendorPoImportInfo }>("/api/purchase_orders/override", { import_id: upload.id, ids, keep });
      notify(ids.length ? `${formatCount(ids.length)} row${ids.length === 1 ? "" : "s"} overridden, ${formatCount(keep.length)} kept.` : "Earlier values kept.");
      onDone(data);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not override.", "error");
    } finally {
      setBusy(false);
    }
  }
  const all = picked.length === open.length && open.length > 0;
  return (
    <Sheet open wide onClose={onClose} title="Rows already uploaded with other values" icon={<UploadIcon size={18} />}
           description={<>{upload.filename}: {formatCount(open.length)} row{open.length === 1 ? " was" : "s were"} uploaded before with different values. Tick the ones to override with this file; the rest keep their earlier values.</>}
           footer={<>
             <Button variant="ghost" onClick={() => apply(false)} disabled={busy}>Keep current values</Button>
             <Button variant="primary" onClick={() => apply(true)} disabled={busy || picked.length === 0}>{busy ? "Saving…" : `Override ${formatCount(picked.length)} selected`}</Button>
           </>}>
      <div className="overflow-hidden rounded-lg border border-line">
        <Table dense minWidth="min-w-[760px]">
          <thead>
            <tr>
              <Th className="w-10"><input type="checkbox" checked={all} onChange={() => setPicked(all ? [] : open.map((c) => c.id))} aria-label="Select all" className="h-4 w-4 accent-accent" /></Th>
              <Th>Row</Th><Th>{received ? "Invoice · part" : "Order"}</Th><Th>Vendor</Th><Th>Current</Th><Th>In this file</Th>
            </tr>
          </thead>
          <tbody>
            {open.map((c) => {
              const changed = (a?: string | null, b?: string | null) => a !== b ? "font-semibold text-dec" : "";
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => setPicked((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])}>
                  <Td><input type="checkbox" checked={picked.includes(c.id)} readOnly className="h-4 w-4 accent-accent" aria-label={`Override row ${c.row}`} /></Td>
                  <Td className="tabular text-ink-muted">{c.row}</Td>
                  <Td className="py-2">
                    <span className="block font-medium">{received ? `Invoice ${c.invoice_number}` : c.part_number}</span>
                    <span className="block text-xs text-ink-muted">{received ? c.part_number : `PO ${c.po_number}${c.ship_date ? ` · ship ${formatDate(c.ship_date)}` : ""}`}</span>
                  </Td>
                  <Td className="max-w-44 truncate" title={c.vendor}>{c.vendor}</Td>
                  <Td className="py-2">
                    {!received && <span className="block truncate" title={c.old.number}>{c.old.number}</span>}
                    <span className="block text-xs text-ink-muted">{formatQty(c.old.qty)} pcs{c.old.received_on ? ` · ${formatDate(c.old.received_on)}` : ""}</span>
                  </Td>
                  <Td className="py-2">
                    {!received && <span className={`block truncate ${changed(c.old.number, c.new.number)}`} title={c.new.number}>{c.new.number}</span>}
                    <span className={`block text-xs ${changed(c.old.qty, c.new.qty) || "text-ink-muted"}`}>{formatQty(c.new.qty)} pcs{c.new.received_on ? ` · ${formatDate(c.new.received_on)}` : ""}</span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </Sheet>
  );
}
