import type { ReactNode } from "react";

// Toolbar above a list: summary on the left, search and filter controls on the right. `wrap`: on phones the controls
// that do not fit go to the next line (for a toolbar with several buttons beside the search).
export function ListToolbar({ summary, children, wrap = false }: { summary?: ReactNode; children: ReactNode; wrap?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
      <p className="min-w-0 text-sm text-ink-muted">{summary}</p>
      <div className={`ml-auto flex w-full items-center gap-1.5 sm:w-auto ${wrap ? "flex-wrap sm:flex-nowrap" : ""}`}>{children}</div>
    </div>
  );
}
