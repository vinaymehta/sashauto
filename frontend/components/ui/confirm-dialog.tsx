"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AlertIcon } from "../icons";
import { Button } from "./button";

// Small centered confirmation for destructive actions. Closes on Escape, outside click or Cancel.
// Escape is caught before other listeners so it does not also close a side panel underneath.
export function ConfirmDialog({ title, children, confirmLabel = "Delete", busy = false, error, onConfirm, onCancel }: {
  title: string; children?: ReactNode; confirmLabel?: string; busy?: boolean; error?: string | null;
  onConfirm: () => void; onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!busy) onCancel();
    };
    const onPointer = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-neutral-950/30 p-4 backdrop-blur-sm">
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
           className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3.5">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dec-bg text-dec">
            <AlertIcon size={18} />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-lg font-semibold text-ink">{title}</h2>
            {children && <div className="mt-1 text-sm text-ink-muted">{children}</div>}
            {error && <p className="mt-2 text-sm font-medium text-dec">{error}</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy} className="bg-dec! hover:bg-dec-mark!">
            {busy ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
