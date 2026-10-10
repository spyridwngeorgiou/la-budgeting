import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";

// Filters are URLs: every chip is a link built with withParams()
// (src/lib/url.ts), so a choice is shareable, survives a reload and never
// drops the other filters. ONE chip style for the whole app.

const CHIP = "inline-flex min-h-9 items-center gap-1.5 border px-3 py-1 text-small whitespace-nowrap transition-colors";
const CHIP_ON = "border-navy bg-navy text-panel-ink";
const CHIP_OFF = "border-chip-border text-text hover:border-navy hover:text-ink";

export function FilterChip({
  href,
  active = false,
  count,
  children,
  className = "",
}: {
  href: string;
  active?: boolean;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined} className={cn(CHIP, active ? CHIP_ON : CHIP_OFF, className)}>
      {children}
      {count !== undefined && <span className={cn("num", active ? "text-panel-muted" : "text-muted")}>{count}</span>}
    </Link>
  );
}

// Mutually exclusive views (Πίνακας · Χρονοδιάγραμμα · Ημερολόγιο): joined chips.
export function Segmented({
  label,
  options,
  active,
  className = "",
}: {
  label: string;
  options: { key: string; label: ReactNode; href: string }[];
  active: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex", className)}>
      {options.map((o, i) => (
        <Link
          key={o.key}
          href={o.href}
          aria-current={o.key === active ? "true" : undefined}
          className={cn(CHIP, o.key === active ? CHIP_ON : CHIP_OFF, i > 0 && "-ml-px")}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

// The filter row above a table: chips (and selects) on the left, actions on
// the right; wraps on narrow screens.
export function Toolbar({
  children,
  actions,
  label,
  className = "",
}: {
  children?: ReactNode;
  actions?: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div role="toolbar" aria-label={label} className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
