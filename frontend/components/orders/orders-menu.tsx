"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { UploadChoice } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { CheckIcon, ChevronDownIcon, DownloadIcon, PlusIcon, UploadIcon } from "../icons";
import { useDismiss } from "../use-dismiss";

// Button with a dropdown panel below it, right-aligned; `children` gets a function that closes the panel.
function Dropdown({ label, className = "", width, children }: {
  label: ReactNode; className?: string; width: string; children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
              className={`inline-flex h-9 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-base font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900 ${open ? "bg-neutral-50" : ""} ${className}`}>
        {label}
        <ChevronDownIcon size={14} className={`shrink-0 text-ink-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className={`absolute right-0 top-11 z-40 max-w-[90vw] origin-top-right animate-pop-in overflow-hidden rounded-lg border border-line bg-surface shadow-pop ${width}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

// "Version" button: chooses which upload's order data the Orders page shows (`selectedId` null = current
// data, latest upload). The dropdown lists each upload by file name, date, time and uploader.
export function UploadPicker({ uploads, latestId, selectedId, onSelect }: {
  uploads: UploadChoice[]; latestId?: number; selectedId: number | null; onSelect: (id: number | null) => void;
}) {
  if (uploads.length === 0) return null;

  return (
    <Dropdown width="w-[26rem]" label="Version">
      {(close) => (
        <>
          <p className="px-4 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-ink-muted">Order data of upload</p>
          <div className="max-h-72 overflow-y-auto pb-1">
            {uploads.map((u) => {
              const current = u.id === latestId;
              const active = (selectedId ?? latestId) === u.id;
              return (
                <button key={u.id} role="menuitemradio" aria-checked={active} type="button"
                        onClick={() => { close(); onSelect(current ? null : u.id); }}
                        className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm text-ink transition-colors hover:bg-canvas">
                  <CheckIcon size={14} className={`mt-0.5 shrink-0 ${active ? "text-ink" : "invisible"}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{current ? "Current · " : ""}{u.original_filename}</span>
                    <span className="block text-xs text-ink-muted">{formatDateTime(u.completed_at)} · {u.uploaded_by ?? "—"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Dropdown>
  );
}

// Orders page actions: upload a file, create an order (admin; `onCreate`), download the shown upload.
export function OrderActions({ downloadId, onUpload, onCreate }: { downloadId?: number; onUpload: () => void; onCreate?: () => void }) {
  return (
    <Dropdown label="Actions" width="w-56">
      {(close) => (
        <div className="py-1">
          <Item icon={<UploadIcon size={16} />} onClick={() => { close(); onUpload(); }}>Upload file</Item>
          {onCreate && <Item icon={<PlusIcon size={16} />} onClick={() => { close(); onCreate(); }}>Create order</Item>}
          {downloadId !== undefined && (
            <a role="menuitem" href={`/api/uploads/${downloadId}/download`} download onClick={close}
               className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-base text-ink transition-colors hover:bg-canvas">
              <DownloadIcon size={16} className="text-ink-muted" />Download .xlsx
            </a>
          )}
        </div>
      )}
    </Dropdown>
  );
}

function Item({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitem" type="button" onClick={onClick}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-base text-ink transition-colors hover:bg-canvas">
      <span className="text-ink-muted">{icon}</span>{children}
    </button>
  );
}
