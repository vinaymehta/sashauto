"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { BUSINESS_LABEL, BUSINESS_VIEWS, getBusiness, setBusiness, type BusinessKey, type BusinessView } from "@/lib/business";
import { CheckIcon } from "./icons";
import { Dropdown } from "./orders/orders-menu";
import { clearApiCache } from "./use-api";

const BusinessContext = createContext<{ view: BusinessView; setView: (view: BusinessView) => void }>({ view: "all", setView: () => {} });

// Holds the business view of the top bar (lib/business). Changing it clears the API cache; the app shell re-renders
// the page so everything loads the new business's data.
export function BusinessProvider({ children }: { children: ReactNode }) {
  const [view, setState] = useState<BusinessView>(() => getBusiness());
  const setView = useCallback((next: BusinessView) => {
    setBusiness(next);
    clearApiCache();
    setState(next);
  }, []);
  return <BusinessContext.Provider value={{ view, setView }}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  return useContext(BusinessContext);
}

// "Business" dropdown in the page header (Dashboard, Orders): which business's data the app shows, All (both), DTP or
// GMBH. It applies to every page.
export function BusinessPicker() {
  const { view, setView } = useBusiness();
  return (
    <Dropdown width="w-56" label={<><span className="text-ink-muted">Business</span><span className="font-semibold text-ink">{BUSINESS_LABEL[view]}</span></>}>
      {(close) => (
        <div className="py-1">
          {BUSINESS_VIEWS.map((b) => (
            <button key={b.key} type="button" role="menuitemradio" aria-checked={view === b.key}
                    onClick={() => { close(); if (view !== b.key) setView(b.key); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-50 ${view === b.key ? "font-semibold text-ink" : "text-ink-muted"}`}>
              <span>{b.label}<span className="ml-2 text-xs font-normal text-ink-faint">{b.key === "all" ? "DTP and GMBH together" : "only this business"}</span></span>
              {view === b.key && <CheckIcon size={14} className="shrink-0 text-ink" />}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

// Business picker for something that belongs to one business (an upload, a new order): DTP or GMBH.
export function BusinessChoice({ value, onChange }: { value: BusinessKey | null; onChange: (business: BusinessKey) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium text-ink">Business</span>
      <div role="radiogroup" aria-label="Business" className="inline-flex rounded-md border border-line bg-neutral-50 p-0.5 text-sm font-medium">
        {(["dtp", "gmbh"] as const).map((b) => (
          <button key={b} type="button" role="radio" aria-checked={value === b} onClick={() => onChange(b)}
                  className={`rounded px-4 py-1.5 transition-colors ${value === b ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-muted hover:text-ink"}`}>
            {BUSINESS_LABEL[b]}
          </button>
        ))}
      </div>
      {!value && <span className="text-xs text-dec">Choose DTP or GMBH</span>}
    </div>
  );
}
