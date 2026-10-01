"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Vendor } from "@/lib/types";
import { TruckIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { Sheet } from "../ui/sheet";

// Side panel to add a vendor, or rename one (`vendor` given).
export function VendorFormPanel({ vendor, onClose, onSaved }: { vendor?: Vendor; onClose: () => void; onSaved: (vendor: Vendor) => void }) {
  const notify = useToast();
  const [name, setName] = useState(vendor?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) return setError("Enter the vendor name.");
    setSaving(true);
    setError(null);
    try {
      const res = vendor
        ? await api.patch<{ data: Vendor }>(`/api/vendors/${vendor.id}`, { name: name.trim() })
        : await api.post<{ data: Vendor }>("/api/vendors", { name: name.trim() });
      notify(vendor ? `Vendor renamed to ${res.data.name}.` : `Vendor ${res.data.name} added.`);
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
      description={vendor ? "Rename this vendor. Its parts stay as they are." : "Add the vendor, then add its parts from the vendor's panel."}
      icon={<TruckIcon size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form onSubmit={save} className="rounded-lg border border-line bg-white px-5 py-4 shadow-card">
        <Field label="Vendor Name" htmlFor="vendor-name" error={error} required>
          <Input id="vendor-name" autoFocus value={name} maxLength={200} invalid={!!error} className="w-full"
                 aria-describedby={error ? "vendor-name-error" : undefined} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Sheet>
  );
}
