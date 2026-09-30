"use client";

import { useRef } from "react";
import { CloseIcon, SearchIcon } from "../icons";

// Live search field: results update as you type (callers debounce the server request).
// × or Escape clears it.
export function SearchInput({ value, onSearch, placeholder, label, className = "" }: {
  value: string; onSearch: (value: string) => void; placeholder: string; label: string; className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={`group relative ${className}`}>
      <SearchIcon size={15} aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint transition-colors group-focus-within:text-ink" />
      <input
        ref={ref}
        type="text"
        role="searchbox"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onSearch(""); } }}
        className="h-9 w-full rounded-md border border-neutral-300 bg-white pl-9 pr-9 text-base text-ink placeholder:text-ink-faint transition-colors duration-150 hover:border-neutral-400 focus:border-neutral-500 focus:outline-none"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => { onSearch(""); ref.current?.focus(); }}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 animate-fade-in items-center justify-center rounded text-ink-faint transition-colors hover:bg-neutral-100 hover:text-ink">
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  );
}
