"use client";

import { useState } from "react";
import type { Vendor, VendorProduct } from "@/lib/types";
import { formatCount, formatQty } from "@/lib/format";
import { RelatedLink } from "../orders/related-popover";
import { useApi, useDebounced } from "../use-api";
import { Alert } from "../ui/feedback";
import { SearchInput } from "../ui/search-input";
import { Skeleton } from "../ui/skeleton";
import { formatAmount } from "./price-format";
import { VendorDetails } from "./vendor-details-panel";

// Vendor summary (opened from a vendor name link): the vendor's code, place of supply and part count, its parts with
// price per piece, MOQ and Current Inventory (a Part Number opens its Product summary in the same panel), then its
// contact, tax and address details. Read only; the vendor is edited on the Vendors page.
export function VendorSummaryPanel({ vendorId, uploadId }: { vendorId: number; uploadId?: number }) {
  const vendor = useApi<{ data: Vendor }>(`/api/vendors/${vendorId}`);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const parts = useApi<{ data: VendorProduct[] }>(`/api/vendors/${vendorId}/products`, { q });
  if (vendor.error) return <Alert title="Could not load the vendor">{vendor.error.message}</Alert>;
  if (!vendor.data) return <Skeleton className="h-96 w-full" />;
  const v = vendor.data.data;
  const items = parts.data?.data ?? [];
  const dash = <span className="text-ink-faint">—</span>;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-gradient-to-br from-tint-violet/70 via-white to-white px-5 py-4 shadow-card">
        <h3 className="text-xl font-semibold tracking-tight text-ink">{v.name}</h3>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {([["Code", v.code || "—"], ["Place of supply", v.place_of_supply || "—"], ["Parts", formatCount(v.product_count)]] as [string, string][]).map(([label, value]) => (
            <span key={label} className="rounded-md bg-white px-2 py-1 text-ink-muted ring-1 ring-line">
              {label} <span className="font-semibold text-ink">{value}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Parts</h3>
          <SearchInput label="Search parts" placeholder="Search part, SASH or vendor part" value={search} onSearch={setSearch} className="w-full sm:w-72" />
        </div>
        {parts.error ? <div className="p-4"><Alert title="Could not load the parts">{parts.error.message}</Alert></div> : parts.loading && !parts.data ? (
          <Skeleton className="m-4 h-40" />
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">{q ? "No parts match." : "No parts yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  <th className="px-5 py-2 font-semibold">Part Number</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Price per piece</th>
                  <th className="px-3 py-2 text-right font-semibold">MOQ (pcs)</th>
                  <th className="px-5 py-2 text-right font-semibold">Current Inventory</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-50">
                    <td className="px-5 py-2"><RelatedLink kind="part" value={item.part_number} uploadId={uploadId} /></td>
                    <td className="max-w-64 truncate px-3 py-2 text-ink-muted" title={item.description ?? undefined}>{item.description ?? dash}</td>
                    <td className="px-3 py-2 text-right tabular font-medium text-ink">{formatAmount(item.price_amount, item.price_currency) ?? (item.price_text || dash)}</td>
                    <td className="px-3 py-2 text-right tabular">{item.moq !== null ? formatQty(item.moq) : dash}</td>
                    <td className="px-5 py-2 text-right tabular">{item.available_qty !== null ? formatQty(item.available_qty) : dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <VendorDetails vendor={v} />
    </div>
  );
}
