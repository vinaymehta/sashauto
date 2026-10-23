import type { User } from "./types";

// Sections of the app a user can be given (backend User::SECTIONS) and the level for each: none (hidden), view (see,
// change nothing) or edit. Admins always have edit everywhere; Users is for admins only.
export type Section = "dashboard" | "orders" | "products" | "vendors" | "settings";
export type Level = "none" | "view" | "edit";

export const SECTIONS: { key: Section; label: string; href: string; hint: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/", hint: "Order figures, charts and what needs attention" },
  { key: "orders", label: "Orders", href: "/orders", hint: "Order rows, uploads, adding orders, generating POs and combining orders" },
  { key: "products", label: "Products", href: "/products", hint: "Parts, prices, current inventory and images" },
  { key: "vendors", label: "Vendors", href: "/vendors", hint: "Vendors, their parts and vendor file imports" },
  { key: "settings", label: "Admin Settings", href: "/settings", hint: "Company details, documents, alerts and the portal sync" },
];

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };

// True when the user has at least `level` for the section.
export function can(user: User | null | undefined, section: Section, level: Exclude<Level, "none"> = "view") {
  if (!user) return false;
  if (user.role === "admin") return true;
  return RANK[user.permissions?.[section] ?? "none"] >= RANK[level];
}

// The first page the user may open (after sign-in, or when a page is not allowed); null: no section at all.
export function homePath(user: User | null | undefined) {
  return SECTIONS.find((s) => can(user, s.key))?.href ?? null;
}
