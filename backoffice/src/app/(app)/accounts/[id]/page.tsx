import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { addMonths, currentMonthKey, isMonthKey, monthLabel, monthRange, monthsBetween, shortMonthYearLabel } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import type { AccountKind } from "@/lib/domain/enums";
import { ButtonLink, EmptyState, PageHeader, Stat, StatRow, StatusDot, cn } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE, statusOf, toBalanceCheck } from "../status";
import { CheckDrawer } from "./CheckDrawer";
import { LedgerChart } from "./LedgerChart";
import { MonthFilter } from "./MonthFilter";

const PAGE_SIZE = 100;

// «Ανάλυση κινήσεων» of one account: its balance today, the month's in/out,
// 12 months of in/out, and the paid transactions that make up the balance
// (v_account_ledger, 0091) with the running balance on every row.
export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const month = isMonthKey(sp.month) ? sp.month : null;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  let ledgerQuery = supabase
    .from("v_account_ledger")
    .select("transaction_id, paid_date, tx_date, direction, description, party_name, signed_amount, running_balance", {
      count: "exact",
    })
    .eq("org_id", orgId)
    .eq("account_id", id)
    .order("paid_date", { ascending: false })
    .order("transaction_id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (month) {
    const { start, end } = monthRange(month);
    ledgerQuery = ledgerQuery.gte("paid_date", start).lte("paid_date", end);
  }

  const [{ data: account }, { data: checkRows }, { data: monthly }, { data: ledger, count }] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("org_id", orgId).eq("account_id", id).maybeSingle(),
    supabase.from("v_balance_checks").select("*").eq("org_id", orgId).eq("account_id", id).order("as_of_date", { ascending: false }),
    supabase
      .from("v_account_ledger_monthly")
      .select("month, inflow, outflow")
      .eq("org_id", orgId)
      .eq("account_id", id)
      .order("month", { ascending: false }),
    ledgerQuery,
  ]);
  if (!account) notFound();

  const checks = (checkRows ?? []).map(toBalanceCheck);
  const { status, latest } = statusOf(checks);
  const balance = Number(account.current_balance ?? 0);

  const byMonth = new Map((monthly ?? []).map((m) => [m.month!, { inflow: Number(m.inflow), outflow: Number(m.outflow) }]));
  const thisMonth = currentMonthKey();
  const statMonth = month ?? thisMonth;
  const stat = byMonth.get(statMonth) ?? { inflow: 0, outflow: 0 };
  const chart = monthsBetween(addMonths(thisMonth, -11), thisMonth).map((m) => ({
    label: shortMonthYearLabel(m),
    inflow: byMonth.get(m)?.inflow ?? 0,
    outflow: byMonth.get(m)?.outflow ?? 0,
  }));
  const monthOptions = (monthly ?? []).map((m) => ({ value: m.month!, label: monthLabel(m.month!) }));

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The ledger starts from the opening balance: show it under the oldest row.
  const showOpening = !month && page >= pages;
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/accounts/${id}${s ? `?${s}` : ""}`;
  };
  const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${formatMoney(Math.abs(n))}`;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow={
          <Link href="/accounts" className="hover:text-ink">
            {el.account.back}
          </Link>
        }
        title={account.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {el.account.kindValues[account.kind as AccountKind]} · {el.account.ownerValues[account.owner_scope!]}
              {!account.is_liquid && ` · ${el.account.illiquid}`}
            </span>
            <StatusDot tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
            {latest && (
              <span className="num">
                {el.account.lastCheck} {formatDate(latest.as_of_date)}
              </span>
            )}
          </span>
        }
        actions={
          <CheckDrawer
            accountId={id}
            accountName={account.name!}
            isCash={account.kind === "cash"}
            expectedToday={balance}
            defaultFrom={checks[0]?.as_of_date ?? account.opening_balance_date!}
            checks={checks}
          />
        }
      />

      <StatRow>
        <Stat size="lg" label={el.account.balanceToday} value={`${balance < 0 ? "−" : ""}${formatMoney(Math.abs(balance))}`} />
        <Stat label={`${el.account.monthIn} · ${monthLabel(statMonth)}`} value={formatMoney(stat.inflow)} />
        <Stat label={`${el.account.monthOut} · ${monthLabel(statMonth)}`} value={formatMoney(stat.outflow)} />
      </StatRow>

      <section className="flex flex-col gap-4">
        <h2 className="eyebrow text-muted">{el.account.last12}</h2>
        <LedgerChart data={chart} inflowLabel={el.account.inflow} outflowLabel={el.account.outflow} label={el.account.last12} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="eyebrow text-muted">
            {el.account.ledger} <span className="num">({total})</span>
          </h2>
          <MonthFilter accountId={id} month={month} options={monthOptions} />
        </div>

        {total === 0 && !showOpening ? (
          <EmptyState title={el.account.noRows} />
        ) : (
          <ul className="flex flex-col border-t border-rule">
            {(ledger ?? []).map((r) => {
              const amount = Number(r.signed_amount);
              return (
                <li key={r.transaction_id} className="border-b border-hairline">
                  <Link
                    href={`/transactions?ids=${r.transaction_id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 py-3 hover:bg-hover md:grid-cols-[6.5rem_minmax(0,1fr)_9rem_9rem] md:px-3"
                  >
                    <span className="num col-start-1 row-start-2 text-small text-muted md:row-start-1 md:text-body">
                      {formatDate(r.paid_date)}
                    </span>
                    <span className="col-start-1 row-start-1 min-w-0 truncate text-body text-ink md:col-start-2">
                      {r.party_name || r.description || "—"}
                      {r.party_name && r.description && <span className="text-muted"> · {r.description}</span>}
                    </span>
                    <span
                      className={cn(
                        "num col-start-2 row-start-1 text-right text-body md:col-start-3",
                        amount < 0 ? "text-text" : "text-positive",
                      )}
                    >
                      {signed(amount)}
                    </span>
                    <span className="num col-start-2 row-start-2 text-right text-small text-muted md:col-start-4 md:row-start-1 md:text-body">
                      {formatMoney(Number(r.running_balance))}
                    </span>
                  </Link>
                </li>
              );
            })}
            {showOpening && (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-hairline py-3 md:grid-cols-[6.5rem_minmax(0,1fr)_9rem_9rem] md:px-3">
                <span className="num col-start-1 row-start-2 text-small text-muted md:row-start-1 md:text-body">
                  {formatDate(account.opening_balance_date)}
                </span>
                <span className="col-start-1 row-start-1 text-body text-muted md:col-start-2">{el.account.opening}</span>
                <span className="num col-start-2 row-start-2 text-right text-small text-muted md:col-start-4 md:row-start-1 md:text-body">
                  {formatMoney(Number(account.opening_balance))}
                </span>
              </li>
            )}
          </ul>
        )}

        {pages > 1 && (
          <nav aria-label="Σελίδες" className="flex items-center justify-between gap-3 text-small text-muted">
            {page > 1 ? <ButtonLink href={pageHref(page - 1)} size="sm">← Νεότερες</ButtonLink> : <span />}
            <span className="num">
              {page} / {pages}
            </span>
            {page < pages ? <ButtonLink href={pageHref(page + 1)} size="sm">Παλαιότερες →</ButtonLink> : <span />}
          </nav>
        )}
      </section>
    </div>
  );
}
