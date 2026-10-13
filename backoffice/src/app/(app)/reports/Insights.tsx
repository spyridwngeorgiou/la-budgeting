import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/format";
import { isMonthKey, monthLabel } from "@/lib/dates";
import { KpiBand, LINK_CLASS, ReportChart, ReportDetail, SpecTable, Td, Tr, type KpiItem } from "@/components/ui";
import { changePctLabel, txIdsHref, type Change, type Movement } from "@/lib/finance/insights";

// The read-only insights every report tab shows, in the shared report
// anatomy (components/ui/ReportSection): «Τι άλλαξε» and «Σε σχέση με τον
// στόχο» as figure bands in a chart frame, «Μεγαλύτερες κινήσεις» as a
// folded detail table. Server components; the figures come from
// lib/finance/insights (pure, tested).

const BASIS = "με βάση το συγχρονισμένο αρχείο 184 και τις κινήσεις μετά από αυτό";

// «Δεδομένα έως 30/09/2026 · με βάση …».
export function coverageText(until: string | null): string {
  const when = until ? (isMonthKey(until) ? monthLabel(until) : formatDate(until)) : null;
  return when ? `Δεδομένα έως ${when} · ${BASIS}` : BASIS[0].toUpperCase() + BASIS.slice(1);
}

// A KPI figure that opens the rows behind it.
export function KpiLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} className={LINK_CLASS}>
      {children}
    </Link>
  );
}

export interface ChangeItem {
  label: ReactNode;
  change: Change;
  // «κυρίως …» (insights.whyText).
  why?: string | null;
  href?: string | null;
}

export function ChangePanel({ items, coverage, title = "Τι άλλαξε" }: { items: ChangeItem[]; coverage: string | null; title?: string }) {
  if (items.length === 0) return null;
  const band: KpiItem[] = items.map((it) => ({
    label: it.label,
    value:
      it.change.delta == null ? (
        "—"
      ) : (
        <KpiLink href={it.href}>
          <span className={it.change.delta < 0 ? "text-negative" : undefined}>{formatSignedMoney(it.change.delta)}</span>
        </KpiLink>
      ),
    sub: (
      <>
        {changePctLabel(it.change)}
        {it.change.previous != null && ` · από ${formatMoney(it.change.previous)}`}
        {it.why && <span className="block">{it.why}</span>}
      </>
    ),
  }));
  return (
    <ReportChart title={title} caption={coverageText(coverage)}>
      <KpiBand items={band} />
    </ReportChart>
  );
}

export function TargetPanel({
  items,
  caption,
  title = "Σε σχέση με τον στόχο",
}: {
  items: KpiItem[];
  caption?: ReactNode;
  title?: ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <ReportChart title={title} caption={caption}>
      <KpiBand items={items} />
    </ReportChart>
  );
}

// The movements that move the figure most, each opening its transaction
// (or `href`), and all of them at once in «Κινήσεις».
export function TopMovements({ rows, caption, title = "Μεγαλύτερες κινήσεις" }: { rows: Movement[]; caption?: ReactNode; title?: string }) {
  if (rows.length === 0) return null;
  const all = txIdsHref(rows.filter((r) => !r.href).map((r) => r.id));
  return (
    <ReportDetail title={title} meta={caption}>
      <div className="flex min-w-0 flex-col gap-3">
        <SpecTable label={title}>
          <tbody>
            {rows.map((r, i) => {
              const href = r.href ?? txIdsHref([r.id]);
              return (
                <Tr key={`${r.id ?? "row"}:${i}`}>
                  <Td className="num whitespace-nowrap text-muted">{r.date ? (isMonthKey(r.date) ? monthLabel(r.date) : formatDate(r.date)) : "—"}</Td>
                  <Td strong className="w-full">
                    {href ? (
                      <Link href={href} className={LINK_CLASS}>
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                  </Td>
                  <Td numeric strong className={r.amount < 0 ? "text-negative" : undefined}>
                    {formatMoney(r.amount)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </SpecTable>
        {all && (
          <Link href={all} className="inline-flex items-center self-start text-small text-ink underline underline-offset-4 max-md:min-h-11">
            Άνοιγμα στις κινήσεις →
          </Link>
        )}
      </div>
    </ReportDetail>
  );
}

// «Διαχείριση →» beside a read-only list: the list is managed elsewhere.
export function ManageLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center text-small text-ink underline underline-offset-4 max-md:min-h-11">
      Διαχείριση →
    </Link>
  );
}
