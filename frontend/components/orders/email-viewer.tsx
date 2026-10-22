"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { EmailDraft } from "@/lib/types";
import { CloseIcon, MailIcon } from "../icons";
import { CopyButton } from "../ui/copy-button";
import { Alert, Spinner } from "../ui/feedback";

const PARAGRAPH_STYLE = {
  green: "bg-[#66ff66] underline",
  yellow: "bg-[#ffff66] underline",
  strong: "font-bold underline",
} as const;

// The email to send a vendor with its PO, in a window over the app like the PDF viewer: To, Subject and the message,
// with Copy (the message) in the header. Closes on ✕, Escape or a click outside. `draft` is null while it loads.
export function EmailViewer({ title, draft, error, onClose }: { title: string; draft: EmailDraft | null; error?: string | null; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div data-floating className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-950/50 p-4 animate-fade-in"
         onPointerDown={(e) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); }}>
      <div ref={box} role="dialog" aria-modal aria-label={title}
           className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <p className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-ink"><MailIcon size={15} className="shrink-0 text-tint-violet-ink" />{title}</p>
          <div className="flex items-center gap-1">
            {draft && <CopyButton text={draft.body} html={draft.html} label="Copy" small />}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink-muted hover:bg-subtle hover:text-ink">
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
        {error ? (
          <div className="p-5"><Alert title="Could not load the email">{error}</Alert></div>
        ) : !draft ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <>
            <dl className="divide-y divide-neutral-100 border-b border-line text-sm">
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 px-5 py-2.5">
                <dt className="text-ink-muted">To</dt>
                <dd className="break-words text-ink">{draft.to.join(", ") || <span className="text-ink-faint">No email address on file for this vendor</span>}</dd>
              </div>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 px-5 py-2.5">
                <dt className="text-ink-muted">Subject</dt>
                <dd className="break-words text-ink">{draft.subject}</dd>
              </div>
            </dl>
            {draft.paragraphs ? (
              // As the email will look: SASH's highlighted and bold underlined lines.
              <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4 text-sm leading-6 text-ink">
                {draft.paragraphs.map((p, i) => (
                  <p key={i} className="whitespace-pre-wrap break-words">
                    {p.style ? <span className={PARAGRAPH_STYLE[p.style]}>{p.text}</span> : p.text}
                  </p>
                ))}
              </div>
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-sans text-sm leading-6 text-ink">{draft.body}</pre>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
