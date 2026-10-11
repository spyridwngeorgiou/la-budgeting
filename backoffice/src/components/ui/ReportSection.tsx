import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { athensDateTimeLabel, isMonthKey, monthLabel } from "@/lib/dates";
import { report } from "@/lib/i18n/v2/report";
import { ReferenceKey, type ReferenceKeyKind } from "./chart";
import { cn } from "./cn";
import { PhoneDetails } from "./PhoneDetails";
import { Stat, StatRow } from "./Stat";

// The anatomy of every report tab: each tab answers ONE question.
//
//   <ReportSection>
//     <ReportHeadline>{cashNarrative(...)}</ReportHeadline>   1. the conclusion
//     <KpiBand items={[...]} />                                2. 3-4 figures
//     <ReportChart title="…" caption="…"><BandChart … /></ReportChart>  3. main chart
//     <ReportChart title="Τι κινεί το ταμείο">…</ReportChart>  4. at most one more
//     <ReportDetail title="Ανά μήνα"><SpecTable …/></ReportDetail>  5. the full table
//     <ReportMethod>the long intro text, moved here</ReportMethod>   6. how it is computed
//     <ReportFooter dataUntil="2026-10-11" />
//   </ReportSection>
//
// Server components (PhoneDetails is the one small client piece). Print
// keeps each block whole (print-avoid-break) and starts a new page per
// ReportSection after the first.

export function ReportSection({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <article aria-label={label} className={cn("report-section flex min-w-0 flex-col gap-8", className)}>
      {children}
    </article>
  );
}

// 1. The conclusion in one sentence, at the section size (20/400).
export function ReportHeadline({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={cn("max-w-4xl text-section font-normal break-words text-ink", className)}>{children}</p>;
}

export interface KpiItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}

// 2. Three or four figures in a hairline band: two columns on a phone, one
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
    <StatRow className={cn("print-avoid-break", className)}>
      {items?.map((it, i) => <Stat key={i} label={it.label} value={it.value} sub={it.sub} size={size} />)}
      {children}
    </StatRow>
  );
}

// 3./4. A chart in its frame: a short title, an optional caption (what the
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
  // Small controls beside the title (a horizon switch); hidden in print.
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("print-avoid-break flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-hairline pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-body font-medium text-ink">{title}</h2>
          {caption && <p className="text-small text-muted">{caption}</p>}
        </div>
        {actions && <div className="print-hide flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
      {keyItems && <ReferenceKey as="div" items={keyItems} />}
    </section>
  );
}

// 5. The detailed table, unchanged: open on a desktop, folded on a phone
// (the title is the toggle). `meta` sits after the title (a count, a CSV link).
export function ReportDetail({
  title = report.detail,
  meta,
  children,
  className = "",
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <PhoneDetails
      className={cn("gap-3", className)}
      summary={
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline pb-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-baseline gap-2">
            <span aria-hidden="true" className="inline-block w-3 text-muted transition-transform group-open:rotate-90">
              ›
            </span>
            <h2 className="text-body font-medium text-ink">{title}</h2>
          </span>
          {meta && <span className="text-small text-muted">{meta}</span>}
        </summary>
      }
    >
      <div className="min-w-0 pt-3">{children}</div>
    </PhoneDetails>
  );
}

// 6. «Πώς υπολογίζεται»: the long explanatory text, folded by default.
export function ReportMethod({
  title = report.method,
  children,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group border-t border-hairline pt-3 text-small text-text", className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block w-3 transition-transform group-open:rotate-90">
          ›
        </span>
        {title}
      </summary>
      <div className="flex max-w-3xl flex-col gap-2 pt-1 pb-2">{children}</div>
    </details>
  );
}

// The one signature line under every report: «Πηγή: Kansha · ενημερώθηκε
// 11/10/2026 14:05 · δεδομένα έως 11/10/2026». `updatedAt` defaults to now
// (Athens clock); `dataUntil` is an ISO date or a month key («2026-10» ->
// «Οκτώβριος 2026»).
export function ReportFooter({
  updatedAt,
  dataUntil,
  className = "",
}: {
  updatedAt?: Date | string;
  dataUntil?: string | null;
  className?: string;
}) {
  const at = updatedAt ? new Date(updatedAt) : new Date();
  const until = dataUntil ? (isMonthKey(dataUntil) ? monthLabel(dataUntil) : formatDate(dataUntil)) : null;
  return (
    <p className={cn("text-small text-muted", className)}>
      {report.footer.source}
      <span aria-hidden="true"> · </span>
      {report.footer.updated} <span className="num">{athensDateTimeLabel(at)}</span>
      {until && (
        <>
          <span aria-hidden="true"> · </span>
          {report.footer.dataUntil} <span className="num">{until}</span>
        </>
      )}
    </p>
  );
}
