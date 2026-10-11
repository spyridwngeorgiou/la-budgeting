import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

// The spec table (P15 table.spec) as building blocks, for the tables whose
// rows are hand-built (a highlighted row, a form per row, a drill-down):
// 12px uppercase muted head on a navy 1px rule, hairline rows, numbers
// right-aligned in tabular figures, a total row on an ink rule. Flush left
// and right: the first and last cells carry no outer padding. No hooks --
// renders on the server. DataTable is the same look for plain lists (with
// cards on phones); use it when rows are just data.
//
//   <SpecTable label="Ταμείο ανά μήνα" stickyFirst>
//     <thead><tr><Th>Μήνας</Th><Th numeric>Υπόλοιπο</Th></tr></thead>
//     <tbody><Tr><Td>Ιαν</Td><Td numeric>1.200,00 €</Td></Tr></tbody>
//     <tfoot><Tr total><Td>Σύνολο</Td><Td numeric>…</Td></Tr></tfoot>
//   </SpecTable>
//
// frame="scroll" (default): the table scrolls sideways inside its own frame
// (the page never does), with a fade on the edge that has more columns and,
// with `stickyFirst`, the first column pinned. frame="none": the bare table
// (a table that turns into cards on phones by its own classes).

export const TH_CLASS =
  "eyebrow border-b border-rule px-3 py-2.5 text-left align-bottom font-medium whitespace-nowrap text-muted first:pl-0 last:pr-0";
export const TD_CLASS = "border-b border-hairline px-3 py-3 align-top text-text first:pl-0 last:pr-0";
export const NUM_CLASS = "num text-right whitespace-nowrap";
// A text link inside a table or a list.
export const LINK_CLASS = "text-ink underline-offset-4 hover:underline";
// The secondary line under a cell's main text.
export const SUB_CLASS = "block text-small text-muted";

export function SpecTable({
  children,
  label,
  caption,
  frame = "scroll",
  stickyFirst = false,
  className = "",
  tableClassName = "",
}: {
  children: ReactNode;
  // Accessible name of the scroll frame (it is focusable, so keyboards can scroll it).
  label?: string;
  caption?: ReactNode;
  frame?: "scroll" | "none";
  stickyFirst?: boolean;
  className?: string;
  tableClassName?: string;
}) {
  const table = (
    <table className={cn("w-full border-collapse text-left text-body", tableClassName)}>
      {caption && <caption className="eyebrow pb-2 text-left text-muted">{caption}</caption>}
      {children}
    </table>
  );
  if (frame === "none") return table;
  return (
    <div
      role={label ? "region" : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      className={cn("scroll-frame max-w-full", stickyFirst && "sticky-first", className)}
    >
      {table}
    </div>
  );
}

export function Th({
  numeric = false,
  className = "",
  scope = "col",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope={scope} className={cn(TH_CLASS, numeric && "text-right", className)} {...props} />;
}

export function Td({
  numeric = false,
  strong = false,
  className = "",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; strong?: boolean }) {
  return <td className={cn(TD_CLASS, numeric && NUM_CLASS, strong && "text-ink", className)} {...props} />;
}

// A body row (hover tint), or with `total` the total row: an ink rule above,
// medium weight -- the one place a table uses weight.
export function Tr({ total = false, className = "", ...props }: HTMLAttributes<HTMLTableRowElement> & { total?: boolean }) {
  return (
    <tr
      className={cn(
        total
          ? "[&>td]:border-t [&>td]:border-b-0 [&>td]:border-t-ink [&>td]:font-medium [&>td]:text-ink [&>th]:border-t [&>th]:border-b-0 [&>th]:border-t-ink [&>th]:text-ink"
          : "hover:bg-hover",
        className,
      )}
      {...props}
    />
  );
}
