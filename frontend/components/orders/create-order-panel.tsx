"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { ManualOrderField, ManualOrderWarning, OrderRow, UploadDetail } from "@/lib/types";
import { PencilIcon, UploadIcon } from "../icons";
import { useToast } from "../toast";
import { UploadCard } from "../upload-card";
import { useApi } from "../use-api";
import { Button } from "../ui/button";
import { Alert } from "../ui/feedback";
import { Field, Input, Select } from "../ui/field";
import { FormSection } from "../ui/form-section";
import { Sheet } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";

// Side panel behind the Orders page's "Upload file" button.
export function UploadOrdersPanel({ onClose, onUploaded }: { onClose: () => void; onUploaded: (upload: UploadDetail) => void }) {
  return (
    <Sheet open onClose={onClose} title="Upload file" icon={<UploadIcon size={18} />}
           description="Drop or choose a Supplier Requirements .xlsx export to compare quantities.">
      <UploadCard onFinished={onUploaded} />
    </Sheet>
  );
}

const asText = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value).trim());

// Side panel to create a manual order, or edit one (`order` given), with every column of the Supplier
// Requirements export. The server validates with the upload rules. A duplicate PO + Part + Type or a Qty
// below MOQ never blocks the order: the warnings are shown first and the Admin chooses "Save anyway" or goes
// back to the form. `shipToLocations` / `commodityTypes` are suggestions.
export function CreateOrderPanel({ order, onClose, onSaved, shipToLocations = [], commodityTypes = [] }: {
  order?: OrderRow; onClose: () => void; onSaved: () => void; shipToLocations?: string[]; commodityTypes?: string[];
}) {
  const notify = useToast();
  const { data, error: fieldsError } = useApi<{ data: ManualOrderField[] }>("/api/manual_orders/fields");
  const fields = data?.data ?? [];
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(order?.source_data ?? {}).map(([k, v]) => [k, asText(v)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ManualOrderWarning[]>([]);
  const [saving, setSaving] = useState(false);

  const set = (label: string) => (value: string) => {
    setValues((v) => ({ ...v, [label]: value }));
    setErrors((e) => ({ ...e, [label]: "" }));
  };

  async function save(e?: FormEvent, confirmed = false) {
    e?.preventDefault();
    const missing = Object.fromEntries(fields.filter((f) => f.required && !values[f.label]?.trim()).map((f) => [f.label, `${f.label} is missing.`]));
    setErrors(missing);
    if (Object.keys(missing).length > 0) return setError("Fill in the required fields.");
    setSaving(true);
    setError(null);
    try {
      const body = { values: Object.fromEntries(fields.map((f) => [f.label, values[f.label]?.trim() ?? ""])), confirmed };
      const res = order
        ? await api.patch<{ data: OrderRow; warnings: ManualOrderWarning[] }>(`/api/manual_orders/${order.id}`, body)
        : await api.post<{ data: OrderRow; warnings: ManualOrderWarning[] }>("/api/manual_orders", body);
      onSaved();
      notify(order ? "Order saved." : `Order PO ${res.data.po_number} created.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "confirmation_required") {
        setWarnings(err.details as ManualOrderWarning[]);
        return;
      }
      if (err instanceof ApiError && err.details && typeof err.details === "object") setErrors(err.details as Record<string, string>);
      setError(err instanceof ApiError ? err.message : "Could not save the order.");
    } finally {
      setSaving(false);
    }
  }

  const confirming = warnings.length > 0;
  const field = (f: ManualOrderField) => (
    <OrderField key={f.label} field={f} value={values[f.label] ?? ""} error={errors[f.label]} onChange={set(f.label)}
                suggestions={suggestionsFor(f.label, shipToLocations, commodityTypes)} />
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={order ? "Edit order" : "Create order"}
      description={order ? `PO ${order.po_number} · ${order.order_type}` : "Enter the order details with the columns of the order Excel file."}
      icon={<PencilIcon size={18} />}
      wide
      footer={confirming ? (
        <>
          <Button variant="ghost" onClick={() => setWarnings([])} disabled={saving}>Back</Button>
          <Button variant="primary" onClick={() => save(undefined, true)} disabled={saving}>{saving ? "Saving…" : "Save anyway"}</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => save()} disabled={saving || fields.length === 0}>
            {saving ? "Saving…" : order ? "Save" : "Create order"}
          </Button>
        </>
      )}
    >
      {confirming ? (
        <div className="space-y-3">
          <Alert tone="info" title={order ? "The order is not saved yet." : "The order is not created yet."}>
            Check the warnings below. Save anyway to continue, or go back to change the order.
          </Alert>
          {warnings.map((w) => (
            <Alert key={w.code} tone="warning" title={w.code === "duplicate_order" ? "Order already exists" : "Below MOQ"}>{w.message}</Alert>
          ))}
        </div>
      ) : fieldsError ? (
        <Alert title="Could not load the form">{fieldsError.message}</Alert>
      ) : fields.length === 0 ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <form onSubmit={save} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <FormSection title="Order">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.filter((f) => f.required).map(field)}</div>
          </FormSection>
          <FormSection title="Other columns">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.filter((f) => !f.required).map(field)}</div>
          </FormSection>
          <button type="submit" hidden />
        </form>
      )}
    </Sheet>
  );
}

function suggestionsFor(label: string, shipToLocations: string[], commodityTypes: string[]) {
  const key = label.toLowerCase();
  return key === "ship to location" ? shipToLocations : key === "commodity type" ? commodityTypes : undefined;
}

function OrderField({ field, value, error, onChange, suggestions }: {
  field: ManualOrderField; value: string; error?: string; onChange: (value: string) => void; suggestions?: string[];
}) {
  const id = `order-${field.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const listId = suggestions?.length ? `${id}-options` : undefined;
  return (
    <Field label={field.label} htmlFor={id} error={error || null} required={field.required}>
      {field.kind === "type" ? (
        <Select id={id} className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : (
        <Input id={id} value={value} invalid={!!error} className="w-full" list={listId}
               type={field.kind === "date" ? "date" : "text"} inputMode={field.kind === "quantity" || field.kind === "number" ? "decimal" : undefined}
               aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </Field>
  );
}
