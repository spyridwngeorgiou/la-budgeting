import Link from "next/link";
import type { ReactNode } from "react";
import { shell } from "@/lib/i18n/v2/shell";
import { cn } from "./cn";

// «Να γίνουν»: things that need a person, by severity. Severity is a 2px
// bar on the left plus its word (ΕΠΕΙΓΟΝ / ΠΡΟΣΟΧΗ / ΕΝΗΜΕΡΩΣΗ), never a
// fill. Each item is one link to where it gets fixed.

export type Severity = "urgent" | "attention" | "info";

const BAR: Record<Severity, string> = {
  urgent: "border-negative",
  attention: "border-warning",
  info: "border-chip-border",
};
const WORD: Record<Severity, string> = {
  urgent: "text-negative",
  attention: "text-warning",
  info: "text-muted",
};

export function Worklist({ children, label, className = "" }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("flex flex-col border-t border-hairline", className)}>
      {children}
    </ul>
  );
}

export function WorklistItem({
  severity,
  title,
  meta,
  count,
  amount,
  href,
}: {
  severity: Severity;
  title: ReactNode;
  meta?: ReactNode;
  count?: number;
  // Already formatted, with its sign.
  amount?: ReactNode;
  href?: string;
}) {
  const body = (
    <div className={cn("flex items-start gap-4 border-l-2 py-3 pr-2 pl-4", BAR[severity])}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("eyebrow", WORD[severity])}>{shell.ui.severity[severity]}</span>
        <span className="text-body text-ink">{title}</span>
        {meta && <span className="text-small text-muted">{meta}</span>}
      </div>
      {(count !== undefined || amount) && (
        <div className="flex shrink-0 flex-col items-end gap-0.5 pt-4">
          {amount && <span className="num text-sm text-ink">{amount}</span>}
          {count !== undefined && <span className="num text-small text-muted">{count}</span>}
        </div>
      )}
      {href && (
        <span aria-hidden="true" className="shrink-0 pt-4 text-muted">
          →
        </span>
      )}
    </div>
  );
  return (
    <li className="border-b border-hairline">
      {href ? (
        <Link href={href} className="block hover:bg-hover">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
