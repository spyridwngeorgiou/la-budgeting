import type { ReactNode } from "react";
import { cn } from "./cn";
import { Menu } from "./Menu";

// The top of every page: eyebrow · title · ONE navy rule. At most two
// visible actions; everything else goes in the «⋯» overflow. The actions
// wrap under the title on narrow screens instead of overflowing.
export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
  overflow,
  children,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  // Up to two buttons / links.
  actions?: ReactNode;
  // Menu items (MenuItem / MenuLink) for the «⋯» menu.
  overflow?: ReactNode;
  // Rendered under the rule (tabs, a glance row ...).
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-rule pb-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          {eyebrow && <p className="eyebrow text-muted">{eyebrow}</p>}
          <h1 className="text-title font-normal break-words text-ink">{title}</h1>
          {meta && <div className="text-small text-muted">{meta}</div>}
        </div>
        {(actions || overflow) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {overflow && <Menu>{overflow}</Menu>}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

// A numbered section: accent numeral «01» and a title, like the P15 table
// of contents. Hairline under it, not the navy rule (that is the page's).
export function SectionHeader({
  numeral,
  title,
  actions,
  className = "",
  as: Tag = "h2",
}: {
  numeral?: string | number;
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  const n = typeof numeral === "number" ? String(numeral).padStart(2, "0") : numeral;
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline pb-3", className)}>
      <Tag className="flex items-baseline gap-4 text-section font-normal text-ink">
        {n && <span className="num text-numeral font-light text-accent">{n}</span>}
        <span>{title}</span>
      </Tag>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// «Έργο · Q004 · 12 κινήσεις»: short facts joined by middle dots.
export function MetaList({ items, className = "" }: { items: ReactNode[]; className?: string }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false && i !== "");
  return (
    <p className={cn("text-small text-muted", className)}>
      {shown.map((item, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {item}
        </span>
      ))}
    </p>
  );
}

// Label / value rows with hairlines (a contract's terms, a record's fields).
export function KeyValue({
  items,
  columns = 1,
  className = "",
}: {
  items: { label: ReactNode; value: ReactNode; numeric?: boolean }[];
  columns?: 1 | 2;
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-x-8", columns === 2 && "md:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-hairline py-2.5">
          <dt className="text-small text-muted">{it.label}</dt>
          <dd className={cn("text-right text-sm text-ink", it.numeric && "num")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
