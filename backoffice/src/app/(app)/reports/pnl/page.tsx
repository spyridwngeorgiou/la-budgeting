import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, PageHeader, SectionHeader, cn } from "@/components/ui";
import { FRAME, LINK, NUM, ROW, TABLE, TD, TH, TOUCH, ViewSwitch } from "../ui";
import { addMonths, currentYear, firstOfMonth, isMonthKey, lastOfMonth, shortMonthLabel } from "@/lib/dates";
import { BUSINESS_LINES, PNL_LINES, pnlTable, type PnlGroup } from "@/lib/finance/pnl";

// Αποτελέσματα. Every figure is pnl_summary() / v_pnl_lines (0067): net of
// VAT, accrual basis, only the interest of a loan. This page only picks the
// year, the grouping and whether scheduled rows count, then lays out rows.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const DRILL_LIMIT = 200;

export default async function PnlPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const thisYear = currentYear();
  const yearRaw = Number(one(sp.year));
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= thisYear + 5 ? yearRaw : thisYear;
  const group: PnlGroup = one(sp.by) === "line" ? "business_line" : "month";
  const withScheduled = one(sp.scheduled) === "1";
  const cellBucket = one(sp.cell) ?? null;
  const cellLine = one(sp.line) ?? null;

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { data, error } = await supabase.rpc("pnl_summary", {
    p_org: orgId,
    p_from: from,
    p_to: to,
    p_group: group,
    p_include_scheduled: withScheduled,
  });
  if (error) throw error;

  const buckets =
    group === "month"
      ? Array.from({ length: 12 }, (_, i) => addMonths(`${year}-01`, i))
      : BUSINESS_LINES.filter((b) => (data ?? []).some((r) => r.bucket === b));
  const table = pnlTable(data ?? [], buckets);
  const t = el.reports;

  const query = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      year: year === thisYear ? null : String(year),
      by: group === "business_line" ? "line" : null,
      scheduled: withScheduled ? "1" : null,
      cell: null,
      line: null,
      ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/reports/pnl?${s}` : "/reports/pnl";
  };

  // Drill-down: the transactions behind one cell.
  const drillable = cellLine && (PNL_LINES as readonly string[]).includes(cellLine);
  let drill: { id: string; tx_date: string; amount: number; label: string; scheduled: boolean }[] = [];
  let drillTruncated = false;
  if (drillable && cellLine) {
    let q = supabase
      .from("v_pnl_lines")
      .select("transaction_id, tx_date, signed_amount, is_scheduled")
      .eq("org_id", orgId)
      .eq("line", cellLine)
      .eq("scope", "business")
      .order("tx_date")
      .limit(DRILL_LIMIT + 1);
    if (cellBucket && group === "month" && isMonthKey(cellBucket)) {
      q = q.gte("tx_date", firstOfMonth(cellBucket)).lte("tx_date", lastOfMonth(cellBucket));
    } else {
      q = q.gte("tx_date", from).lte("tx_date", to);
      if (cellBucket && group === "business_line" && (BUSINESS_LINES as readonly string[]).includes(cellBucket)) {
        q = q.eq("business_line", cellBucket as (typeof BUSINESS_LINES)[number]);
      }
    }
    if (!withScheduled) q = q.eq("is_scheduled", false);
    const { data: lines, error: drillError } = await q;
    if (drillError) throw drillError;
    drillTruncated = (lines ?? []).length > DRILL_LIMIT;
    const rows = (lines ?? []).slice(0, DRILL_LIMIT);
    const ids = rows.map((r) => r.transaction_id).filter((id): id is string => !!id);
    const { data: txs } = ids.length
      ? await supabase.from("transactions").select("id, description, counterparty_name").in("id", ids)
      : { data: [] };
    const byId = new Map((txs ?? []).map((x) => [x.id, x]));
    drill = rows.map((r) => {
      const tx = byId.get(r.transaction_id ?? "");
      return {
        id: r.transaction_id ?? "",
        tx_date: r.tx_date ?? "",
        amount: Number(r.signed_amount ?? 0),
        label: tx?.description?.trim() || tx?.counterparty_name || "—",
        scheduled: Boolean(r.is_scheduled),
      };
    });
  }

  const bucketLabel = (b: string) =>
    group === "month" ? shortMonthLabel(b) : (t.businessLines[b as keyof typeof t.businessLines] ?? b);
  const years = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t.pnlTitle} meta={<span className="block max-w-3xl">{t.pnlIntro}</span>} />

      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <ViewSwitch
          label={t.year}
          options={years.map((y) => ({ key: String(y), label: String(y), href: query({ year: y === thisYear ? null : String(y) }) }))}
          active={String(year)}
        />
        <ViewSwitch
          label={t.pnlView}
          options={[
            { key: "month", label: t.byMonth, href: query({ by: null }) },
            { key: "business_line", label: t.byLine, href: query({ by: "line" }) },
          ]}
          active={group}
        />
        <ViewSwitch
          label={t.includeScheduled}
          options={[
            { key: "0", label: el.common.no, href: query({ scheduled: null }) },
            { key: "1", label: el.common.yes, href: query({ scheduled: "1" }) },
          ]}
          active={withScheduled ? "1" : "0"}
        />
      </div>

      {buckets.length === 0 ? (
        <p className="border-y border-hairline py-6 text-sm text-muted">{t.pnlEmpty}</p>
      ) : (
        <div className={FRAME}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={cn(TH, "sticky left-0 z-10")} />
                {buckets.map((b) => (
                  <th key={b} scope="col" className={cn(TH, "text-right")}>
                    {bucketLabel(b)}
                  </th>
                ))}
                <th scope="col" className={cn(TH, "text-right")}>
                  {t.total}
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const isSum = row.line === "gross_profit" || row.line === "result";
                if (!isSum && row.total === 0 && row.line !== "revenue") return null;
                // Subtotal rows sit over an ink rule, like the spec sheet's totals.
                const td = cn(TD, isSum && "border-t border-t-ink font-medium text-ink");
                return (
                  <tr key={row.line} className="hover:bg-hover">
                    <td className={cn(td, "sticky left-0 z-[1] bg-canvas whitespace-nowrap text-ink")}>
                      {t.lines[row.line]}
                      {row.line === "unclassified" && row.total !== 0 && (
                        <span className="ml-1.5">
                          <Badge tone="amber">!</Badge>
                        </span>
                      )}
                    </td>
                    {buckets.map((b, i) => {
                      const v = row.values[i];
                      const cell = v === 0 ? <span className="text-muted">—</span> : formatMoney(v);
                      const active = cellLine === row.line && cellBucket === b;
                      return (
                        <td key={b} className={cn(td, NUM, active && "bg-hover outline outline-1 -outline-offset-1 outline-navy")}>
                          {isSum || v === 0 ? (
                            cell
                          ) : (
                            <Link href={query({ cell: b, line: row.line })} scroll={false} className={LINK}>
                              {cell}
                            </Link>
                          )}
                        </td>
                      );
                    })}
                    <td className={cn(td, NUM, "text-ink")}>
                      {isSum || row.total === 0 ? (
                        formatMoney(row.total)
                      ) : (
                        <Link href={query({ line: row.line })} scroll={false} className={LINK}>
                          {formatMoney(row.total)}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {table.rows.some((r) => r.line === "unclassified" && r.total !== 0) && (
        <p className="-mt-3 border-l-2 border-warning pl-3 text-small text-muted">
          <Link href="/reports/quality" className="text-ink underline underline-offset-4">
            {t.lines.unclassified}
          </Link>
          : {t.unclassifiedHint}
        </p>
      )}

      {drillable && cellLine && (
        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader
            title={`${t.drillDown}: ${t.lines[cellLine as keyof typeof t.lines]}${cellBucket ? ` · ${bucketLabel(cellBucket)}` : ` · ${year}`}`}
            actions={
              <div className="flex items-center gap-4 text-small">
                {drill.length > 0 && drill.length <= 100 && (
                  <Link
                    href={`/transactions?ids=${drill.map((d) => d.id).join(",")}`}
                    className={cn("inline-flex items-center text-ink underline underline-offset-4", TOUCH)}
                  >
                    {t.pnlOpenInTransactions}
                  </Link>
                )}
                <Link href={query({})} scroll={false} className={cn("inline-flex items-center text-ink underline underline-offset-4", TOUCH)}>
                  {el.common.close}
                </Link>
              </div>
            }
          />
          {drill.length === 0 ? (
            <p className="text-sm text-muted">{t.noItems}</p>
          ) : (
            <div className={FRAME}>
              <table className={TABLE}>
                <tbody>
                  {drill.map((d) => (
                    <tr key={d.id} className={ROW}>
                      <td className="num py-2.5 pr-3 whitespace-nowrap text-muted">{formatDate(d.tx_date)}</td>
                      <td className="w-full py-2.5 pr-3 text-ink">
                        <Link href={`/transactions?ids=${d.id}`} className={LINK}>
                          {d.label}
                        </Link>
                        {d.scheduled && <span className="ml-1 text-xs text-muted">({t.pnlScheduledTag})</span>}
                      </td>
                      <td className={cn("py-2.5 text-ink", NUM)}>{formatMoney(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {drillTruncated && <p className="text-small text-muted">{t.pnlDrillTruncated}</p>}
        </section>
      )}
    </div>
  );
}

