import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

// One inline notice for the whole app: a thin 2px bar on the left in the
// tone's colour, then the text. No fill, no box, no icon (P15). The bar
// carries the severity; errors and confirmations also colour their text
// (short, one-line outcomes), warnings and information stay readable in
// the text colour.
//
//   <Notice tone="negative" role="alert">{error}</Notice>
//   <Notice tone="warning">Λείπουν 3 γραμμές.</Notice>

export type NoticeTone = "info" | "warning" | "negative" | "positive";

const TONE: Record<NoticeTone, string> = {
  info: "border-chip-border text-text",
  warning: "border-warning text-text",
  negative: "border-negative text-negative",
  positive: "border-positive text-positive",
};

export function Notice({
  tone = "info",
  size = "body",
  as: Tag = "p",
  className = "",
  internal = false,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  tone?: NoticeTone;
  // For the team only (a data-quality warning, an internal note): hidden in
  // presentation mode and in print.
  internal?: boolean;
  size?: "body" | "small";
  // "p" for a line of text; "div" when it holds blocks; "ul" for a list.
  as?: "p" | "div" | "span" | "ul" | "aside" | "section";
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "border-l-2 py-0.5",
        Tag === "ul" ? "list-disc pl-8" : "pl-3",
        size === "small" ? "text-small" : "text-body",
        Tag === "span" && "inline-block",
        TONE[tone],
        internal && "present-hide print-hide",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
