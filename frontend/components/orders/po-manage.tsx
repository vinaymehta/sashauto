"use client";

import { useState } from "react";
import type { OrderRow } from "@/lib/types";
import { can } from "@/lib/permissions";
import { formatDate, formatQty } from "@/lib/format";
import { useApi } from "../use-api";
import { useSession } from "../session";
import { useBusiness } from "../business-switch";
import { Alert } from "../ui/feedback";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { ListUploadSheet } from "./list-upload-sheet";
import { RelatedLink } from "./related-popover";
import { DeliveryCell } from "./delivery-cell";
import { InvoiceUploadPanel } from "./invoice-upload-panel";
import { VendorOrderSection } from "./vendor-order-section";
import { TruckIcon, UploadIcon } from "../icons";

// Manage one PO from its panel: each Firm / Order line with its status (change it here), its vendor PO (place or see
// it), and Upload invoice / Upload vendor PO list that act on THIS PO only: the server refuses an invoice with lines of
// other POs, and takes only this PO's rows from a vendor PO list, so no other PO's order is touched.
export function PoManageSection({ po, uploadId, onChanged }: { po: string; uploadId?: number; onChanged: () => void }) {
  const me = useSession().user;
  const editor = can(me, "orders", "edit");
  const canInvoice = me?.role === "admin" || me?.role === "warehouse_manager";
  // Only the current order data can be changed: an earlier upload's rows are history.
  const current = uploadId === undefined;
  const { data, error, loading, reload } = useApi<{ data: OrderRow[] }>("/api/orders", { q: po, per_page: 100, upload_id: uploadId });
  const [invoice, setInvoice] = useState<"inc" | "india" | null>(null);
  const [vendorOf, setVendorOf] = useState<number | null>(null);
  const refresh = () => { reload(); onChanged(); };

  const rows = (data?.data ?? []).filter((r) => r.po_number === po && (r.order_type === "Firm" || r.order_type === "Order"));
  if (!editor && !canInvoice) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Manage this PO</h3>
          <p className="text-xs text-ink-muted">Status, vendor PO and uploads here only affect PO {po}.</p>
        </div>
        {current && (
          <div className="flex flex-wrap items-center gap-2">
            {canInvoice && <InvoiceButton only="inc" onClick={() => setInvoice("inc")} />}
            {me?.role === "admin" && <InvoiceButton only="india" onClick={() => setInvoice("india")} />}
            {editor && <ListUploadButton kind="orders" po={po} onDone={refresh} />}
            {editor && <ListUploadButton kind="received" po={po} onDone={refresh} />}
          </div>
        )}
      </div>
      {error ? (
        <div className="p-4"><Alert title="Could not load the orders of this PO">{error.message}</Alert></div>
      ) : loading && !data ? (
        <Skeleton className="m-4 h-24" />
      ) : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No Firm or Order line of this PO to manage.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <li key={`${r.manual ? "m" : "o"}${r.id}`} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-14 tabular text-xs text-ink-muted">{r.po_line_number}</span>
                <span className="min-w-0 flex-1">
                  <RelatedLink kind="part" value={r.part_number} uploadId={uploadId} />
                  <span className="block text-xs text-ink-muted">{r.order_type} · ship {formatDate(r.ship_date)} · Qty {r.qty === null ? "—" : formatQty(r.qty)}</span>
                </span>
                {current ? <DeliveryCell row={r.member_of ? { ...r, id: r.member_of.id, qty: r.member_of.total } : r} role={me?.role} onChanged={refresh} />
                  : null}
                {current && editor && (
                  <Button size="sm" variant={vendorOf === r.id ? "primary" : "secondary"} onClick={() => setVendorOf(vendorOf === r.id ? null : r.id)}>
                    {vendorOf === r.id ? "Hide vendor PO" : r.placed ? "Vendor PO" : "Place vendor PO"}
                  </Button>
                )}
              </div>
              {vendorOf === r.id && <VendorOrderSection key={r.id} orderId={r.member_of ? r.member_of.id : r.id} manual={!!r.manual} onPlaced={refresh} />}
            </li>
          ))}
        </ul>
      )}
      {invoice && <InvoiceUploadPanel po={po} only={invoice} onClose={() => setInvoice(null)} onSaved={refresh} />}
    </section>
  );
}

// Upload vendor PO / Upload received: the button opens a slider with the file's description, its example and Choose file.
function ListUploadButton({ kind, po, part, onDone }: { kind: "orders" | "received"; po: string; part?: string; onDone: () => void }) {
  const { view: business } = useBusiness();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" disabled={business === "all"} onClick={() => setOpen(true)}
              title={business === "all" ? "Choose DTP or GMBH first: the file is for one business." : undefined}>
        <UploadIcon size={14} className="text-ink-muted" />{kind === "received" ? "Upload received" : "Upload vendor PO"}
      </Button>
      {open && <ListUploadSheet kind={kind} po={po} part={part} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

// The invoice buttons: the slider they open has the example.
function InvoiceButton({ only, onClick }: { only: "inc" | "india"; onClick: () => void }) {
  const inc = only === "inc";
  return (
    <Button size="sm" onClick={onClick} title={inc ? "The SASH Inc invoice to Deere: its Qty becomes delivered (outbound)" : "The SASH India export invoice: its Qty becomes dispatched"}>
      <TruckIcon size={14} className="text-ink-muted" />{inc ? "Upload Deere invoice" : "Upload SASH India invoice"}
    </Button>
  );
}

// Order details actions: status, and the Deere (SASH Inc) invoice / SASH India invoice / vendor PO list uploads, all
// limited to this order's PO and part (the server refuses an invoice with other lines).
export function OrderUploads({ row, onChanged }: { row: OrderRow; onChanged: () => void }) {
  const me = useSession().user;
  const [invoice, setInvoice] = useState<"inc" | "india" | null>(null);
  const canInvoice = me?.role === "admin" || me?.role === "warehouse_manager";
  return (
    <>
      <DeliveryCell row={row.member_of ? { ...row, id: row.member_of.id, qty: row.member_of.total } : row} role={me?.role} onChanged={onChanged} />
      {canInvoice && <InvoiceButton only="inc" onClick={() => setInvoice("inc")} />}
      {me?.role === "admin" && <InvoiceButton only="india" onClick={() => setInvoice("india")} />}
      {can(me, "orders", "edit") && <ListUploadButton kind="orders" po={row.po_number} part={row.part_number} onDone={onChanged} />}
      {can(me, "orders", "edit") && <ListUploadButton kind="received" po={row.po_number} part={row.part_number} onDone={onChanged} />}
      {invoice && <InvoiceUploadPanel po={row.po_number} part={row.part_number} only={invoice} onClose={() => setInvoice(null)} onSaved={onChanged} />}
    </>
  );
}
