import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { athensDateTimeLabel, isMonthKey, monthLabel } from "@/lib/dates";
import { report } from "@/lib/i18n/v2/report";
import { ReferenceKey, type ReferenceKeyKind } from "./chart";
import { cn } from "./cn";
import { Stat, StatRow } from "./Stat";

// The anatomy of every report tab, as on 7/10: one clean page that answers
// ONE question.
//
//   <PageHeader title="…" meta="one line: what it is, how it is computed" actions={<ExportCsvLink />} />
//   [the tab's filters, one row]
//   <ReportSection>
//     <KpiBand items={[...]} />                                     3-4 figures, each «± έναντι προηγ. μήνα»
//     <ReportChart title="…" caption="…"><BandChart … /></ReportChart>  ONE chart
//     <ReportHistory count={12} open={!!drill}>table + drill</ReportHistory>  closed
//     <ReportFooter dataUntil="2026-10-11" issues={…} />             one line
//   </ReportSection>
//
// Server components only: the history is a native <details>.

export function ReportSection({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <article aria-label={label} className={cn("flex min-w-0 flex-col gap-6", className)}>
      {children}
    </article>
  );
}

export interface KpiItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}

// Three or four figures in a hairline band: two columns on a phone, one
// row from md. Each Stat steps its size down to its cell, so long amounts
// never overflow at 390px. `items`, or Stat children.
export function KpiBand({
  items,
  children,
  size = "md",
  className = "",
}: {
  items?: KpiItem[];
  children?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <StatRow className={cn(className)}>
      {items?.map((it, i) => <Stat key={i} label={it.label} value={it.value} sub={it.sub} size={size} />)}
      {children}
    </StatRow>
  );
}

// The one chart in its frame: a short title, an optional caption (what the
// chart shows, in a line), the chart, then an optional key for reference
// marks the chart itself does not draw a key for.
export function ReportChart({
  title,
  caption,
  keyItems,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  caption?: ReactNode;
  keyItems?: { label: string; kind: ReferenceKeyKind }[];
  // Small controls beside the title (a scenario switch).
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-hairline pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-body font-medium text-ink">{title}</h2>
          {caption && <p className="text-small text-muted">{caption}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
      {keyItems && <ReferenceKey as="div" items={keyItems} />}
    </section>
  );
}

// «▸ Ιστορικό ανά μήνα (12)»: the full table, closed by default and opened
// with one click, as in a Power BI report. A row that drills down links to
// the page's own ?month= / ?cell= state; the page then renders this `open`
// with the movements under the table. A native <details>: React only sets
// `open` when the prop changes, so a reader's own toggle survives.
export function ReportHistory({
  title = report.history,
  count,
  meta,
  open = false,
  children,
  className = "",
}: {
  title?: ReactNode;
  // Rows behind the summary: «(12)».
  count?: number;
  // After the title, right-aligned (a short note).
  meta?: ReactNode;
  open?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details open={open || undefined} className={cn("group flex min-w-0 flex-col", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline pb-1 [&::-webkit-details-marker]:hidden">
        <span className="flex items-baseline gap-2">
          <span aria-hidden="true" className="inline-block w-3 text-muted transition-transform group-open:rotate-90">
            ▸
          </span>
          <h2 className="text-body font-medium text-ink">
            {title}
            {count != null && <span className="num font-normal text-muted"> ({count})</span>}
          </h2>
        </span>
        {meta && <span className="text-small text-muted">{meta}</span>}
      </summary>
      <div className="flex min-w-0 flex-col gap-4 pt-3">{children}</div>
    </details>
  );
}

// The one line under every report: «Δεδομένα έως 11/10/2026 · ενημερώθηκε
// 11/10/2026 14:05 · 3 θέματα ποιότητας →». `dataUntil` is an ISO date or a
// month key («2026-10» -> «Οκτώβριος 2026»); `updatedAt` defaults to now
// (Athens clock); `issues` are the open quality checks that touch the
// report's figures (none: the link is left out).
export function ReportFooter({
  updatedAt,
  dataUntil,
  issues,
  className = "",
}: {
  updatedAt?: Date | string;
  dataUntil?: string | null;
  issues?: { count: number; href: string } | null;
  className?: string;
}) {
  const at = updatedAt ? new Date(updatedAt) : new Date();
  const until = dataUntil ? (isMonthKey(dataUntil) ? monthLabel(dataUntil) : formatDate(dataUntil)) : null;
  return (
    <p className={cn("flex flex-wrap items-center border-t border-hairline pt-3 text-small text-muted", className)}>
      {until && (
        <span>
          {report.footer.dataUntil} <span className="num">{until}</span>
          <span aria-hidden="true">&nbsp;·&nbsp;</span>
        </span>
      )}
      <span>
        {report.footer.updated} <span className="num">{athensDateTimeLabel(at)}</span>
      </span>
      {issues && issues.count > 0 && (
        <>
          <span aria-hidden="true">&nbsp;·&nbsp;</span>
          <Link href={issues.href} className="inline-flex items-center text-ink underline-offset-4 hover:underline max-md:min-h-11">
            {report.footer.issues(issues.count)}
          </Link>
        </>
      )}
    </p>
  );
}
