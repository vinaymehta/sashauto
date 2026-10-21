// The business view chosen in the Business dropdown: one of the two Deere suppliers SASH works for (DTP, GMBH), whose
// order data is kept apart, or "all" for both together. Sent with every API request (X-Business) and remembered in
// this browser; DTP until another is chosen.
export type BusinessView = "all" | "dtp" | "gmbh";
export type BusinessKey = Exclude<BusinessView, "all">;

export const BUSINESS_VIEWS: { key: BusinessView; label: string }[] = [
  { key: "all", label: "All" }, { key: "dtp", label: "DTP" }, { key: "gmbh", label: "GMBH" },
];
export const BUSINESS_LABEL: Record<BusinessView, string> = { all: "All", dtp: "DTP", gmbh: "GMBH" };

const STORAGE_KEY = "sash.business";
let current: BusinessView = "dtp";
let loaded = false;

export function getBusiness(): BusinessView {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "all" || saved === "dtp" || saved === "gmbh") current = saved;
    } catch {
      // storage blocked: stay on DTP
    }
  }
  return current;
}

export function setBusiness(view: BusinessView) {
  current = view;
  loaded = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}
