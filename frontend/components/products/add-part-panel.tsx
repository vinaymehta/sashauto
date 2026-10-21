"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Product } from "@/lib/types";
import { PlusIcon } from "../icons";
import { useToast } from "../toast";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Field, Input, Textarea } from "../ui/field";
import { Sheet } from "../ui/sheet";

const NUMBER = /^\d+(\.\d{1,4})?$/;

// Products → Add part (SASH team): a part that is not in an order file or vendor file yet. Part Number, description,
// SASH / vendor part, Commodity Type, pack, MOQ and Deere's price; vendors are added next, in the part panel.
export function AddPartPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (product: Product) => void }) {
  const notify = useToast();
  const [v, setV] = useState({ part_number: "", description: "", sash_part: "", vendor_part: "", commodity_type: "", pack_size: "1", moq_sets: "", customer_price: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [key]: e.target.value }));

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const next: Record<string, string> = {};
    if (!v.part_number.trim()) next.part_number = "Enter the Part Number.";
    if (!/^\d+$/.test(v.pack_size.trim()) || Number(v.pack_size) < 1) next.pack_size = "Enter a whole number, 1 or more.";
    if (v.moq_sets.trim() && !NUMBER.test(v.moq_sets.trim())) next.moq_sets = "Enter a number, or leave blank.";
    if (v.customer_price.trim() && !NUMBER.test(v.customer_price.trim())) next.customer_price = "Enter a price, or leave blank.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ data: Product }>("/api/products", Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])));
      notify(`Part ${res.data.part_number} added.`);
      onCreated(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        setErrors(Object.fromEntries(Object.entries(err.details as Record<string, string[]>).map(([k, m]) => [k, m.join(", ")])));
      }
      setError(err instanceof ApiError ? err.message : "Could not add the part.");
      setSaving(false);
    }
  }

  const pack = Math.max(parseInt(v.pack_size, 10) || 1, 1);
  return (
    <Sheet open onClose={onClose} title="Add part" icon={<PlusIcon size={18} />}
           description="A part added by the SASH team. Add its vendors and their prices next, in the part panel."
           footer={<>
             <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
             <Button variant="primary" onClick={() => save()} disabled={saving}>{saving ? "Adding…" : "Add part"}</Button>
           </>}>
      <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-white px-5 py-4 shadow-card">
        {error && <Alert>{error}</Alert>}
        <Field label="Part Number" htmlFor="ap-part" error={errors.part_number} hint="Deere's Part Number. It cannot be changed later." required>
          <Input id="ap-part" autoFocus className="w-full uppercase" placeholder="e.g. JXA22628" value={v.part_number} onChange={set("part_number")} invalid={!!errors.part_number} />
        </Field>
        <Field label="Description" htmlFor="ap-description" optional>
          <Textarea id="ap-description" rows={2} className="w-full" maxLength={1000} value={v.description} onChange={set("description")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SASH Part" htmlFor="ap-sash" optional><Input id="ap-sash" className="w-full" maxLength={100} value={v.sash_part} onChange={set("sash_part")} /></Field>
          <Field label="Vendor Part" htmlFor="ap-vendor" optional><Input id="ap-vendor" className="w-full" maxLength={100} value={v.vendor_part} onChange={set("vendor_part")} /></Field>
        </div>
        <Field label="Commodity Type" htmlFor="ap-commodity" optional><Input id="ap-commodity" className="w-full" maxLength={100} value={v.commodity_type} onChange={set("commodity_type")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pieces per set" htmlFor="ap-pack" error={errors.pack_size} hint="1 when sold as single pieces." required>
            <Input id="ap-pack" inputMode="numeric" className="w-full" value={v.pack_size} onChange={set("pack_size")} invalid={!!errors.pack_size} />
          </Field>
          <Field label={pack > 1 ? "MOQ (sets)" : "MOQ (pcs)"} htmlFor="ap-moq" error={errors.moq_sets} optional>
            <Input id="ap-moq" inputMode="decimal" className="w-full" value={v.moq_sets} onChange={set("moq_sets")} invalid={!!errors.moq_sets} />
          </Field>
        </div>
        <Field label="Customer price (per 100 pcs)" htmlFor="ap-price" error={errors.customer_price} hint="Deere's Unit Price, as in the order file." optional>
          <Input id="ap-price" inputMode="decimal" className="w-full" value={v.customer_price} onChange={set("customer_price")} invalid={!!errors.customer_price} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
