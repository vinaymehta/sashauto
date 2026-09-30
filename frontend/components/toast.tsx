"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";

type Tone = "success" | "error";
interface Toast { id: number; tone: Tone; message: string }

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((message: string, tone: Tone = "success") => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink shadow-pop">
            <span className={t.tone === "success" ? "text-up" : "text-down"}>
              {t.tone === "success" ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
            </span>
            <p className="flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-ink-faint hover:text-ink"><CloseIcon size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
