import type { ReactNode } from "react";
import { shell } from "@/lib/i18n/v2/shell";
import { cn } from "./cn";

// A figure with its label: eyebrow label, Light 300 tabular value, an
// optional line under it. `onPanel` for the navy glance panel.
export function Stat({
  label,
  value,
  sub,
  size = "md",
  onPanel = false,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: "md" | "lg";
  onPanel?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className={cn("eyebrow", onPanel ? "text-panel-muted" : "text-muted")}>{label}</span>
      <span className={cn("num font-light", size === "lg" ? "text-figure" : "text-figure-sm", onPanel ? "text-panel-ink" : "text-ink")}>
        {value}
      </span>
      {sub && <span className={cn("text-small", onPanel ? "text-panel-muted" : "text-muted")}>{sub}</span>}
    </div>
  );
}

// A row of stats separated by hairlines; wraps to two columns on phones.
export function StatRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-5 border-y border-hairline py-5 md:flex md:flex-wrap md:gap-x-0 md:[&>*]:min-w-40 md:[&>*]:flex-1 md:[&>*:not(:first-child)]:border-l md:[&>*:not(:first-child)]:border-hairline md:[&>*:not(:first-child)]:pl-6 md:[&>*]:pr-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

// «Με μια ματιά»: the navy panel (P15 page 16), the one solid block on a
// page. Either `items` (label/value/sub) or children Stats with onPanel.
export function GlancePanel({
  title = shell.ui.glance,
  items,
  children,
  footer,
  className = "",
}: {
  title?: ReactNode;
  items?: { label: ReactNode; value: ReactNode; sub?: ReactNode }[];
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <aside className={cn("flex flex-col gap-5 bg-panel p-6 text-panel-ink lg:p-8", className)}>
      <h2 className="eyebrow text-panel-muted">{title}</h2>
      {items && (
        <dl className="flex flex-col gap-4">
          {items.map((it, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <dt className="text-small text-panel-muted">{it.label}</dt>
              <dd className="num text-figure-sm text-panel-ink">{it.value}</dd>
              {it.sub && <dd className="text-small text-panel-muted">{it.sub}</dd>}
            </div>
          ))}
        </dl>
      )}
      {children}
      {footer && <div className="mt-auto border-t border-panel-hairline pt-4 text-small text-panel-ink">{footer}</div>}
    </aside>
  );
}
