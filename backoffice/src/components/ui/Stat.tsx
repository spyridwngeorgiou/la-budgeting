import type { ReactNode } from "react";
import { figureLength } from "@/lib/format";
import { shell } from "@/lib/i18n/v2/shell";
import { cn } from "./cn";

// Big figures step down by their length AND the width their cell actually
// has (container queries on the Stat), so «1.234.567,89 €» never overflows a
// quarter of a row or a phone half. Literal class strings: Tailwind only
// sees what is written out. `max` is the size a short figure gets.
const FIT = {
  lg: {
    1: "text-section @min-[9.25rem]:text-figure-sm @min-[14rem]:text-figure",
    2: "text-section @min-[11rem]:text-figure-sm @min-[16.5rem]:text-figure",
    3: "text-body @min-[10rem]:text-section @min-[13.5rem]:text-figure-sm @min-[20.5rem]:text-figure",
  },
  md: {
    1: "text-section @min-[8rem]:text-figure-sm",
    2: "text-section @min-[11rem]:text-figure-sm",
    3: "text-body @min-[10rem]:text-section @min-[13.5rem]:text-figure-sm",
  },
} as const;

// The size classes for a figure; the element above it must be an @container.
export function figureFit(length: 1 | 2 | 3, max: "md" | "lg" = "lg"): string {
  return FIT[max][length];
}

function textOf(node: ReactNode): string | null {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    const parts = node.map(textOf);
    return parts.every((p) => p !== null) ? parts.join("") : null;
  }
  return null;
}

// A figure with its label: eyebrow label, Light 300 tabular value, an
// optional line under it. `onPanel` for the navy glance panel. The value
// steps down to fit (see FIT); it never overflows its cell.
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
  const text = textOf(value);
  // A value that is not plain text (a link, a badge) keeps the full size
  // but still wraps instead of overflowing.
  const fit = text === null ? (size === "lg" ? "text-figure" : "text-figure-sm") : figureFit(figureLength(text), size);
  return (
    <div className={cn("@container flex min-w-0 flex-col gap-1", className)}>
      <span className={cn("eyebrow break-words", onPanel ? "text-panel-muted" : "text-muted")}>{label}</span>
      <span className={cn("num font-light whitespace-normal [overflow-wrap:anywhere]", fit, onPanel ? "text-panel-ink" : "text-ink")}>
        {value}
      </span>
      {sub && <span className={cn("text-small break-words", onPanel ? "text-panel-muted" : "text-muted")}>{sub}</span>}
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
      <h2 className="heading text-section text-panel-ink">{title}</h2>
      {items && (
        <dl className="flex flex-col gap-4">
          {items.map((it, i) => (
            <div key={i} className="@container flex min-w-0 flex-col gap-0.5">
              <dt className="text-small text-panel-muted">{it.label}</dt>
              <dd className={cn("num font-light whitespace-normal text-panel-ink [overflow-wrap:anywhere]", figureFit(figureLength(textOf(it.value) ?? ""), "md"))}>
                {it.value}
              </dd>
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
