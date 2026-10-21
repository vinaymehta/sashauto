"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, DownloadIcon, PrintIcon } from "../icons";

// In-app PDF viewer: the document on a white page in a large window over the app (not a new browser tab).
// Closes on ✕, Escape (only the viewer, not a panel underneath) or a click outside. Print opens the browser's print
// dialog for the document; `downloadUrl` adds a Download button.
export function PdfViewer({ url, title, downloadUrl, onClose }: { url: string; title: string; downloadUrl?: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The browser's own PDF toolbar and side panel are hidden so only the page shows.
  const src = `${url}${url.includes("#") ? "&" : "#"}toolbar=0&navpanes=0&view=FitH`;

  return createPortal(
    <div data-floating className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-950/50 p-4 animate-fade-in"
         onPointerDown={(e) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); }}>
      <div ref={box} role="dialog" aria-modal aria-label={title}
           className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-muted hover:bg-subtle hover:text-ink">
              <PrintIcon size={15} />Print
            </button>
            {downloadUrl && (
              <a href={downloadUrl} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-muted hover:bg-subtle hover:text-ink">
                <DownloadIcon size={15} />Download
              </a>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink-muted hover:bg-subtle hover:text-ink">
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
        <iframe ref={frame} src={src} title={title} className="min-h-0 w-full flex-1 bg-neutral-100" />
      </div>
    </div>,
    document.body,
  );
}
