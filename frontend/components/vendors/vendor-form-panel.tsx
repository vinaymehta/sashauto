"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Vendor } from "@/lib/types";
import { TruckIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Field, Input, Textarea } from "../ui/field";
import { Sheet } from "../ui/sheet";

// Side panel to add a vendor, or edit one (`vendor` given): name and contact details (email, phone, GST, address).
export function VendorFormPanel({ vendor, onClose, onSaved }: { vendor?: Vendor; onClose: () => void; onSaved: (vendor: Vendor) => void }) {
  const notify = useToast();
  const [name, setName] = useState(vendor?.name ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [gst, setGst] = useState(vendor?.gst ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) return setError("Enter the vendor name.");
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setEmailError("Enter a valid email address, or leave blank.");
    setSaving(true);
    setError(null);
    setEmailError(null);
    const body = { name: name.trim(), email: email.trim(), phone: phone.trim(), gst: gst.trim(), address: address.trim() };
    try {
      const res = vendor
        ? await api.patch<{ data: Vendor }>(`/api/vendors/${vendor.id}`, body)
        : await api.post<{ data: Vendor }>("/api/vendors", body);
      notify(vendor ? `Vendor ${res.data.name} saved.` : `Vendor ${res.data.name} added.`);
      onSaved(res.data);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the vendor.");
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={vendor ? "Edit vendor" : "Add vendor"}
      description={vendor ? "Edit the vendor's name and contact details. Its parts stay as they are." : "Add the vendor, then add its parts from the vendor's panel."}
      icon={<TruckIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
        <Field label="Vendor Name" htmlFor="vendor-name" error={error} required>
          <Input id="vendor-name" autoFocus value={name} maxLength={200} invalid={!!error} className="w-full"
                 aria-describedby={error ? "vendor-name-error" : undefined} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="vendor-email" hint="Vendor orders placed from the Orders page are emailed here." error={emailError} optional>
          <Input id="vendor-email" type="email" value={email} maxLength={254} invalid={!!emailError} className="w-full" placeholder="orders@vendor.com"
                 aria-describedby={emailError ? "vendor-email-error" : undefined} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone Number" htmlFor="vendor-phone" optional>
            <Input id="vendor-phone" type="tel" value={phone} maxLength={40} className="w-full" placeholder="+91 98765 43210"
                   onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="GST" htmlFor="vendor-gst" hint="GSTIN for Indian vendors." optional>
            <Input id="vendor-gst" value={gst} maxLength={32} className="w-full uppercase" placeholder="06AABCS1234F1Z5"
                   onChange={(e) => setGst(e.target.value)} />
          </Field>
        </div>
        <Field label="Address" htmlFor="vendor-address" optional>
          <Textarea id="vendor-address" value={address} maxLength={1000} rows={3} className="w-full" onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
