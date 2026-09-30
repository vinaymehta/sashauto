// Placeholders shaped like the content they stand in for, so pages don't jump when data arrives.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-shimmer rounded bg-subtle ${className}`} />;
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="animate-fade-in">
      <div className="flex h-10 items-center gap-6 border-b border-neutral-200 bg-neutral-50 px-6">
        {Array.from({ length: columns }, (_, i) => <Skeleton key={i} className="h-3 flex-1" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-12 items-center gap-6 border-b border-neutral-100 px-6 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={`h-3.5 flex-1 ${(r + c) % 3 === 0 ? "max-w-[60%]" : ""}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-white px-6 py-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-6 w-14" />
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <div className="border-b border-line px-6 py-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
      </div>
      <TableSkeleton rows={rows} columns={columns} />
    </div>
  );
}

export function DetectionSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <div className="px-6 py-5"><Skeleton className="h-5 w-72 max-w-full" /></div>
        <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="bg-white px-6 py-5"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-16" /></div>
          ))}
        </div>
        <div className="px-6 py-4"><Skeleton className="h-4 w-96 max-w-full" /></div>
      </div>
      <PanelSkeleton />
    </div>
  );
}
