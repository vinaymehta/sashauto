import type { ReactNode } from "react";

// Toolbar above a list: summary on the left, search and filter controls on the right.
export function ListToolbar({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
      <p className="min-w-0 text-sm text-ink-muted">{summary}</p>
      <div className="ml-auto flex w-full items-center gap-1.5 sm:w-auto">{children}</div>
    </div>
  );
}
