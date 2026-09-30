import type { ReactNode } from "react";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-ink ${className}`}
    />
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-base text-ink-muted">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "error", title, children }: { tone?: "error" | "warning" | "info"; title?: string; children?: ReactNode }) {
  const styles = {
    error: "border-neutral-900 bg-white text-neutral-900 border-l-4",
    warning: "border-neutral-300 bg-neutral-50 text-neutral-900 border-l-4 border-l-neutral-900",
    info: "border-neutral-200 bg-neutral-50 text-neutral-900",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-base ${styles}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1 text-sm opacity-90" : ""}>{children}</div>}
    </div>
  );
}
