"use client";

import type { ReactNode } from "react";
import type { Vendor } from "@/lib/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { PencilIcon, TruckIcon } from "../icons";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";

const GST_TREATMENT_LABEL: Record<string, string> = {
  registered_regular: "Registered Business - Regular", registered_composition: "Registered Business - Composition",
  unregistered: "Unregistered Business", consumer: "Consumer", overseas: "Overseas", sez: "Special Economic Zone",
  deemed_export: "Deemed Export",
};

// Side panel with everything about a vendor (read-only): contact, tax and payment details, address, the jurisdictional
// tax officer and remarks. `onEdit` (admins) opens the vendor form.
export function VendorDetailsPanel({ vendor, onClose, onEdit }: { vendor: Vendor; onClose: () => void; onEdit?: () => void }) {
  const contact = [vendor.salutation, vendor.first_name, vendor.last_name].filter(Boolean).join(" ") || null;
  const emails = vendor.email ? vendor.email.split(/\s*[,;]\s*/).filter(Boolean) : [];

  return (
    <Sheet
      open
      onClose={onClose}
      title={vendor.name}
      description={<>{vendor.code ? <>Vendor Code <b className="text-ink">{vendor.code}</b> · </> : null}{vendor.vendor_type === "individual" ? "Individual" : "Business"} · {formatCount(vendor.product_count)} part{vendor.product_count === 1 ? "" : "s"}</>}
      icon={<TruckIcon size={18} />}
      footer={onEdit && <Button variant="primary" onClick={onEdit}><PencilIcon size={15} />Edit vendor</Button>}
    >
      <div className="space-y-4">
        <Section title="Contact">
          <Item label="Company Name">{vendor.company_name}</Item>
          <Item label="Contact Person">{contact}</Item>
          <Item label="Contact No">{vendor.phone}</Item>
          <Item label="Mobile">{vendor.mobile}</Item>
          <Item label="Email">
            {emails.length ? emails.map((e) => <a key={e} href={`mailto:${e}`} className="block text-ink underline decoration-neutral-300 underline-offset-2 hover:text-accent">{e}</a>) : null}
          </Item>
          <Item label="Language">{vendor.language}</Item>
        </Section>

        <Section title="Tax and payment">
          <Item label="GST Treatment">{vendor.gst_treatment ? GST_TREATMENT_LABEL[vendor.gst_treatment] ?? vendor.gst_treatment : null}</Item>
          <Item label="GSTIN">{vendor.gst}</Item>
          <Item label="PAN">{vendor.pan}</Item>
          <Item label="Place of Supply">{vendor.place_of_supply}</Item>
          <Item label="GST Rate">{vendor.gst_rate ? `${vendor.gst_rate}%` : null}</Item>
          <Item label="Tax Preference">{vendor.tax_preference === "tax_exempt" ? "Tax Exempt" : "Taxable"}</Item>
          <Item label="Currency">{vendor.currency}</Item>
          <Item label="Payment Terms">{vendor.payment_terms}</Item>
          <Item label="Lead Days">{vendor.lead_days !== null ? `${vendor.lead_days} days` : null}</Item>
          <Item label="Portal">{vendor.portal_enabled ? "Allowed" : "Not allowed"}</Item>
        </Section>

        <Section title="Address">
          <Item label="Address">{vendor.address}</Item>
          <Item label="Jurisdictional Tax Officer">{vendor.tax_officer_address}</Item>
        </Section>

        <Section title="Remarks">
          <Item label="Remarks">{vendor.remarks}</Item>
        </Section>

        <p className="text-xs text-ink-muted">Added {formatDateTime(vendor.created_at)} · last changed {formatDateTime(vendor.updated_at)}</p>
      </div>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <h3 className="border-b border-neutral-100 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h3>
      <dl className="divide-y divide-neutral-100">{children}</dl>
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "" || (Array.isArray(children) && children.length === 0);
  return (
    <div className="grid gap-1 px-5 py-2.5 text-sm sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="whitespace-pre-line break-words text-ink">{empty ? <span className="text-ink-faint">—</span> : children}</dd>
    </div>
  );
}
