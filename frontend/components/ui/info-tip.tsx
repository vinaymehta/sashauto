"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const WIDTH = 288; // px

// "i" button that shows an explanation on hover, focus or click (touch). The bubble is drawn over the page (portal),
// so cards with hidden overflow do not cut it; it opens below the button, or above it near the bottom of the screen.
// Clicks inside a link card do not follow the link.
export function InfoTip({ children, label = "About this card" }: { children: ReactNode; label?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [pinned, setPinned] = useState(false);

  function show() {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 180 > window.innerHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  }
  const hide = () => { if (!pinned) setPos(null); };

  // A pinned (clicked) bubble closes on the next click elsewhere, Escape or scroll.
  useEffect(() => {
    if (!pos) return;
    const close = () => { setPinned(false); setPos(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: PointerEvent) => { if (!button.current?.contains(e.target as Node)) close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [pos]);

  return (
    <>
      <button ref={button} type="button" aria-label={label} aria-expanded={pos !== null}
              onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (pinned) { setPinned(false); setPos(null); } else { setPinned(true); show(); } }}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-neutral-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><path d="M12 7.6v.1" />
        </svg>
      </button>
      {pos && createPortal(
        <div role="tooltip" data-floating style={{ top: pos.top, left: pos.left, width: WIDTH, transform: pos.above ? "translateY(-100%)" : undefined }}
             className="pointer-events-none fixed z-[90] animate-fade-in rounded-lg bg-neutral-900 px-3.5 py-2.5 text-left text-xs font-normal leading-5 text-neutral-100 shadow-xl">
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
