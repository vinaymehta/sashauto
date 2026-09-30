import type { ReactNode } from "react";

export function Panel({ title, description, actions, children, flush = false }: {
  title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
          <div>
            {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-6"}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-base text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <div className="bg-white px-6 py-5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className={`tabular mt-1 text-2xl font-semibold ${color}`}>{value}</dd>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid animate-fade-in grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
      {children}
    </dl>
  );
}
