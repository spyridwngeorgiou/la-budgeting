import Link from "next/link";
import type { ReactNode } from "react";
import { shell } from "@/lib/i18n/v2/shell";
import { cn } from "./cn";
import { Menu } from "./Menu";

// The one table, after P15's table.spec: uppercase 12px head over a navy
// rule, hairline rows, numbers right-aligned in tabular figures, a total
// row over an ink rule. No hooks -- renders on the server.
//
//   mode="responsive" (default): a table from md up, a list of cards below
//     (the `primary` column as the card title, the rest as label/value).
//   mode="scroll": always a table, scrolling sideways on phones (reports,
//     where the columns ARE the content).
//
// The header sticks under the v2 top bar: AppShell sets --sticky-top.

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  // Right-aligned tabular figures (amounts, counts, dates in columns).
  numeric?: boolean;
  // The card title in card mode (one column; the first one if none).
  primary?: boolean;
  // Left out of the card in card mode.
  hideOnCard?: boolean;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowActions,
  totals,
  mode = "responsive",
  empty = shell.ui.empty,
  caption,
  rowHref,
  className = "",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  // Menu items for the row's «⋯» menu.
  rowActions?: (row: T) => ReactNode;
  // Totals row, by column key.
  totals?: Partial<Record<string, ReactNode>>;
  mode?: "responsive" | "scroll";
  empty?: ReactNode;
  caption?: ReactNode;
  // Makes the primary cell a link.
  rowHref?: (row: T) => string | null;
  className?: string;
}) {
  if (rows.length === 0) {
    return <p className={cn("border-y border-hairline py-6 text-sm text-muted", className)}>{empty}</p>;
  }
  const primaryKey = (columns.find((c) => c.primary) ?? columns[0]).key;
  const cellFor = (row: T, c: Column<T>) => {
    const content = c.cell(row);
    const href = c.key === primaryKey ? rowHref?.(row) : null;
    return href ? (
      <Link href={href} className="text-ink underline-offset-4 hover:underline">
        {content}
      </Link>
    ) : (
      content
    );
  };

  const table = (
    <table className="w-full border-collapse text-sm">
      {caption && <caption className="eyebrow pb-2 text-left text-muted">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={cn(
                "eyebrow sticky top-[var(--sticky-top,0px)] z-10 border-b border-rule bg-canvas px-3 py-2.5 text-left font-medium text-muted",
                c.numeric && "text-right",
                c.className,
              )}
            >
              {c.header}
            </th>
          ))}
          {rowActions && (
            <th scope="col" className="sticky top-[var(--sticky-top,0px)] z-10 w-12 border-b border-rule bg-canvas">
              <span className="sr-only">{shell.ui.actions}</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="hover:bg-hover">
            {columns.map((c) => (
              <td
                key={c.key}
                className={cn(
                  "border-b border-hairline px-3 py-3 align-top text-text",
                  c.key === primaryKey && "text-ink",
                  c.numeric && "num text-right",
                  c.className,
                )}
              >
                {cellFor(row, c)}
              </td>
            ))}
            {rowActions && (
              <td className="border-b border-hairline px-1 py-1.5 text-right align-top">
                <Menu>{rowActions(row)}</Menu>
              </td>
            )}
          </tr>
        ))}
      </tbody>
      {totals && (
        <tfoot>
          <tr>
            {columns.map((c, i) => (
              <td
                key={c.key}
                className={cn("border-t border-ink px-3 py-3 font-semibold text-ink", c.numeric && "num text-right", c.className)}
              >
                {totals[c.key] ?? (i === 0 ? shell.ui.total : null)}
              </td>
            ))}
            {rowActions && <td className="border-t border-ink" />}
          </tr>
        </tfoot>
      )}
    </table>
  );

  if (mode === "scroll") {
    return <div className={cn("overflow-x-auto", className)}>{table}</div>;
  }

  const rest = columns.filter((c) => c.key !== primaryKey && !c.hideOnCard);
  const primary = columns.find((c) => c.key === primaryKey)!;
  return (
    <div className={className}>
      <div className="hidden md:block">{table}</div>
      <ul className="flex flex-col border-t border-rule md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex flex-col gap-2 border-b border-hairline py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-body text-ink">{cellFor(row, primary)}</div>
              {rowActions && <Menu>{rowActions(row)}</Menu>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {rest.map((c) => (
                <div key={c.key} className={cn("flex flex-col", c.numeric && "items-end text-right")}>
                  <dt className="text-xs text-muted">{c.header}</dt>
                  <dd className={cn("text-sm text-text", c.numeric && "num")}>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {totals && (
          <li className="flex flex-col gap-1 border-t border-ink py-3">
            <span className="eyebrow text-muted">{shell.ui.total}</span>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {rest
                .filter((c) => totals[c.key] !== undefined)
                .map((c) => (
                  <div key={c.key} className={cn("flex flex-col", c.numeric && "items-end text-right")}>
                    <dt className="text-xs text-muted">{c.header}</dt>
                    <dd className={cn("text-sm font-semibold text-ink", c.numeric && "num")}>{totals[c.key]}</dd>
                  </div>
                ))}
            </dl>
          </li>
        )}
      </ul>
    </div>
  );
}

// An amount with its sign instead of a colour: −3.200,00 € / +12.400,00 €.
// `tone` only for exceptions (an overdue, a negative balance).
export function Amount({
  value,
  format,
  signed = true,
  tone,
  className = "",
}: {
  value: number;
  format: (n: number) => string;
  signed?: boolean;
  tone?: "negative" | "positive";
  className?: string;
}) {
  const sign = !signed || value === 0 ? "" : value > 0 ? "+" : "−";
  return (
    <span className={cn("num", tone === "negative" && "text-negative", tone === "positive" && "text-positive", className)}>
      {sign}
      {format(Math.abs(value))}
    </span>
  );
}
