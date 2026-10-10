import type { ReactNode } from "react";
import { cn } from "./cn";

// Nothing to show: a short title, one sentence of why / what next, and at
// most one action. Between hairlines, never an illustration.
export function EmptyState({
  title,
  body,
  action,
  className = "",
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2 border-y border-hairline py-8", className)}>
      <p className="text-body text-ink">{title}</p>
      {body && <p className="max-w-prose text-small text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
