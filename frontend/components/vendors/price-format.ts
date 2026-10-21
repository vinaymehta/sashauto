import type { VendorProduct } from "@/lib/types";
import { formatQty } from "@/lib/format";

// Formatting of vendor prices and MOQs (vendor parts, Place order, the part panel).

export function formatAmount(amount: string | null, currency: string) {
  if (amount === null) return null;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 4 }).format(Number(amount));
}

type PricedItem = Pick<VendorProduct, "price_amount" | "price_currency" | "price_note"> &
  Partial<Pick<VendorProduct, "set_price_amount" | "pack_size" | "price_text">>;

// The price as written in the vendor file; otherwise "₹12 / pc · ₹60 / set of 5" for a pack part, "₹12" for a part
// sold singly, with the note after.
const CURRENCY_SIGN: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", CNY: "¥" };
const HAS_CURRENCY = /[₹$€£¥]|\b(INR|USD|EUR|GBP|CNY|RMB|RS)\b/i;

export function formatPrice(item: PricedItem) {
  // The file's text, with the currency sign added when the file wrote only the amount ("4.25" → "₹ 4.25").
  if (item.price_text) {
    return HAS_CURRENCY.test(item.price_text) ? item.price_text : `${CURRENCY_SIGN[item.price_currency] ?? item.price_currency} ${item.price_text}`;
  }
  const pack = item.pack_size ?? 1;
  const pc = formatAmount(item.price_amount, item.price_currency);
  const set = formatAmount(item.set_price_amount ?? null, item.price_currency);
  if (!pc && !set) return item.price_note ?? null;
  const price = pack > 1 ? [pc && `${pc} / pc`, set && `${set} / set of ${pack}`].filter(Boolean).join(" · ") : (pc ?? set)!;
  return item.price_note ? `${price} ${item.price_note}` : price;
}

// The MOQ as written in the vendor file; otherwise "200 sets · 2,000 pcs" for a pack part, "150" for a part sold singly.
export function formatMoq(item: { moq: string | null; moq_sets?: string | null; pack_size?: number; moq_text?: string | null }) {
  if (item.moq_text) return item.moq_text;
  const pack = item.pack_size ?? 1;
  if (pack <= 1) return item.moq === null ? null : formatQty(item.moq);
  const sets = item.moq_sets ?? (item.moq === null ? null : String(Number(item.moq) / pack));
  if (sets === null) return null;
  return `${formatQty(sets)} sets · ${formatQty(item.moq ?? String(Number(sets) * pack))} pcs`;
}

// Deere's (customer) price with its currency sign, e.g. "$0.16" (the sign, not "US$"). `currency`: the product's
// customer_currency (DTP's, from Settings).
export function formatCustomer(amount: string | number | null | undefined, currency: string = "USD", digits = 2) {
  if (amount === null || amount === undefined || amount === "") return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: 4 })
    .format(Number(amount));
}
