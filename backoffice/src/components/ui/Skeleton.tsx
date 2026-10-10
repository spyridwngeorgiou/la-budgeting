import type { ReactNode } from "react";
import { cn } from "./cn";

// A placeholder bar while content loads: the frame tint, square.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse bg-frame", className)} />;
}

// Generic per-route loading state: a title over the navy rule, a filter
// row and table-row bars. Close enough to every page's layout that it does
// not "pop" when the real content arrives.
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">…</span>
      <div className="flex flex-col gap-2 border-b border-rule pb-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="flex flex-col">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="border-b border-hairline py-3">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Legacy: the old pages group content in Card. The new design has no cards
// (grouping is space and hairlines), so a Card is now only a hairline frame:
// no fill, no shadow, square. New code uses SectionHeader + hairlines.
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("border border-hairline p-4", className)}>{children}</div>;
}
