import type { ReactNode } from "react";

// A titled white card used to group related fields inside panels.
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
      <header className="border-b border-neutral-100 px-5 py-3.5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </header>
      <div className="space-y-4 px-5 py-5">{children}</div>
    </section>
  );
}
