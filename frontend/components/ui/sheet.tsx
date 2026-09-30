"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "../icons";
import { useDismiss } from "../use-dismiss";

// Side panel that slides in from the right, below the navbar: 40% of the window on larger screens,
// full width on phones. Closes on backdrop click, the close button or Escape. The body is light gray so white
// section cards stand out; `footer` stays pinned at the bottom.
// `top` (px from the top of the window) starts the panel lower, e.g. level with a list card;
// by default it starts right below the 56px navbar.
export function Sheet({ open, title, description, icon, onClose, children, footer, top = 56 }: {
  open: boolean; title: ReactNode; description?: ReactNode; icon?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
  top?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(panel, open, onClose);

  // The page behind the panel must not scroll. The scrollbar's width is replaced with padding so
  // the layout does not shift sideways and the panel reaches the window edge.
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Dimming backdrop behind the drawer. Starts at the drawer's top so the navbar/page header stay clear. */}
      <div aria-hidden style={{ top }} className="fixed inset-x-0 bottom-0 z-40 animate-fade-in bg-neutral-950/20 backdrop-blur-sm" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="sheet-title" style={{ top }}
           className="fixed bottom-0 right-0 z-50 flex w-full animate-slide-in-right flex-col border-l border-neutral-200 bg-neutral-100 shadow-2xl md:w-[40vw] md:min-w-110">
        <header className="flex items-start justify-between gap-4 border-b border-line bg-white px-6 py-5">
          <div className="flex min-w-0 items-start gap-3.5">
            {icon && (
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-tint-violet text-tint-violet-ink ring-1 ring-tint-violet-ink/15">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 id="sheet-title" className="truncate text-lg font-semibold text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close panel"
                  className="-mr-1.5 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-subtle hover:text-ink">
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line bg-white px-6 py-4">{footer}</footer>}
      </div>
    </>
  );
}
