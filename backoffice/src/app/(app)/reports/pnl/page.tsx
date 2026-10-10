import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Pills } from "@/components/Pills";
import { Badge } from "@/components/ui";
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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t.pnlTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t.pnlIntro}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Pills
          label={t.year}
          options={years.map((y) => ({ key: String(y), label: String(y), href: query({ year: y === thisYear ? null : String(y) }) }))}
          active={String(year)}
        />
        <Pills
          label={t.pnlView}
          options={[
            { key: "month", label: t.byMonth, href: query({ by: null }) },
            { key: "business_line", label: t.byLine, href: query({ by: "line" }) },
          ]}
          active={group}
        />
        <Pills
          label={t.includeScheduled}
          options={[
            { key: "0", label: el.common.no, href: query({ scheduled: null }) },
            { key: "1", label: el.common.yes, href: query({ scheduled: "1" }) },
          ]}
          active={withScheduled ? "1" : "0"}
        />
      </div>

      {buckets.length === 0 ? (
        <p className="text-sm text-ink-muted">{t.pnlEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="sticky left-0 bg-bg p-2" />
                {buckets.map((b) => (
                  <th key={b} className="whitespace-nowrap p-2 text-right">
                    {bucketLabel(b)}
                  </th>
                ))}
                <th className="p-2 text-right">{t.total}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const isSum = row.line === "gross_profit" || row.line === "result";
                if (!isSum && row.total === 0 && row.line !== "revenue") return null;
                return (
                  <tr key={row.line} className={`border-t border-line ${isSum ? "bg-bg font-medium" : ""}`}>
                    <td className="sticky left-0 whitespace-nowrap bg-white p-2">
                      {t.lines[row.line]}
                      {row.line === "unclassified" && row.total !== 0 && (
                        <span className="ml-1.5">
                          <Badge tone="amber">!</Badge>
                        </span>
                      )}
                    </td>
                    {buckets.map((b, i) => {
                      const v = row.values[i];
                      const cell = (
                        <span className={v < 0 ? "text-red-ink" : ""}>{v === 0 ? "—" : formatMoney(v)}</span>
                      );
                      const active = cellLine === row.line && cellBucket === b;
                      return (
                        <td key={b} className={`whitespace-nowrap p-2 text-right font-mono ${active ? "bg-sage/40" : ""}`}>
                          {isSum || v === 0 ? (
                            cell
                          ) : (
                            <Link href={query({ cell: b, line: row.line })} scroll={false} className="hover:underline">
                              {cell}
                            </Link>
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap p-2 text-right font-mono">
                      {isSum || row.total === 0 ? (
                        <span className={row.total < 0 ? "text-red-ink" : ""}>{formatMoney(row.total)}</span>
                      ) : (
                        <Link href={query({ line: row.line })} scroll={false} className="hover:underline">
                          <span className={row.total < 0 ? "text-red-ink" : ""}>{formatMoney(row.total)}</span>
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
        <p className="-mt-2 text-xs text-ink-faint">
          <Link href="/reports/quality" className="underline">
            {t.lines.unclassified}
          </Link>
          : {t.unclassifiedHint}
        </p>
      )}

      {drillable && cellLine && (
        <section className="rounded-lg border border-line p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">
              {t.drillDown}: {t.lines[cellLine as keyof typeof t.lines]}
              {cellBucket ? ` · ${bucketLabel(cellBucket)}` : ` · ${year}`}
            </h2>
            <div className="flex items-center gap-3 text-xs">
              {drill.length > 0 && drill.length <= 100 && (
                <Link href={`/transactions?ids=${drill.map((d) => d.id).join(",")}`} className="text-ink-muted underline">
                  {t.pnlOpenInTransactions}
                </Link>
              )}
              <Link href={query({})} scroll={false} className="text-ink-muted underline">
                {el.common.close}
              </Link>
            </div>
          </div>
          {drill.length === 0 ? (
            <p className="text-sm text-ink-muted">{t.noItems}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody>
                {drill.map((d) => (
                  <tr key={d.id} className="border-t border-line first:border-0">
                    <td className="py-1.5 pr-2 text-ink-muted">{formatDate(d.tx_date)}</td>
                    <td className="py-1.5 pr-2">
                      <Link href={`/transactions?ids=${d.id}`} className="hover:underline">
                        {d.label}
                      </Link>
                      {d.scheduled && <span className="ml-1 text-xs text-ink-faint">({t.pnlScheduledTag})</span>}
                    </td>
                    <td className={`py-1.5 text-right font-mono ${d.amount < 0 ? "text-red-ink" : ""}`}>
                      {formatMoney(d.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {drillTruncated && <p className="mt-2 text-xs text-ink-faint">{t.pnlDrillTruncated}</p>}
        </section>
      )}
    </div>
  );
}

