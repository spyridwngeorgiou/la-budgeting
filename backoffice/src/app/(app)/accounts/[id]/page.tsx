import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { addMonths, currentMonthKey, isMonthKey, monthLabel, monthRange, monthsBetween, shortMonthYearLabel, todayAthens } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import type { AccountKind } from "@/lib/domain/enums";
import { Amount, EmptyState, LINK_CLASS, PageHeader, Pager, SUB_CLASS, SectionHeader, SpecTable, Stat, StatRow, Td, Th, Tr, cn } from "@/components/ui";
import { toBalanceCheck } from "../status";
import { BalanceChecks } from "../BalanceAssertion";
import { CheckDrawer } from "../CheckDrawer";
import { AccountFormModal } from "../AccountFormModal";
import { LedgerChart } from "./LedgerChart";
import { MonthFilter } from "./MonthFilter";

const PAGE_SIZE = 100;

// Below md each ledger row is a card (CSS grid), from md up a table row.
const CELL = "block max-md:border-b-0 max-md:p-0 md:table-cell";

// «Ανάλυση κινήσεων» of one account: its balance today, the month's in/out,
// the balance checks («Έλεγχοι υπολοίπου»), 12 months of in/out, and the
// paid transactions that make up the balance (v_account_ledger, 0091) with
// the running balance on every row.
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

  const [{ data: account }, { data: ids }, { data: checkRows }, { data: monthly }, { data: ledger, count }] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("org_id", orgId).eq("account_id", id).maybeSingle(),
    // The two statement identifiers the edit form needs (not in the view).
    supabase.from("accounts").select("iban, account_number").eq("org_id", orgId).eq("id", id).maybeSingle(),
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link href="/accounts" className="hover:text-ink">
            {el.account.back}
          </Link>
        }
        title={account.name}
        meta={
          <>
            {el.account.kindValues[account.kind as AccountKind]} · {el.account.ownerValues[account.owner_scope!]}
            {!account.is_liquid && ` · ${el.account.illiquid}`}
          </>
        }
        actions={
          <>
            <AccountFormModal
              variant="secondary"
              size="md"
              account={{
                id,
                name: account.name!,
                kind: account.kind as AccountKind,
                owner_scope: account.owner_scope!,
                is_liquid: Boolean(account.is_liquid),
                opening_balance: Number(account.opening_balance ?? 0),
                opening_balance_date: account.opening_balance_date!,
                iban: ids?.iban ?? null,
                account_number: ids?.account_number ?? null,
              }}
            />
            <CheckDrawer
              accountId={id}
              accountName={account.name!}
              expectedToday={balance}
              defaultFrom={checks[0]?.as_of_date ?? account.opening_balance_date!}
            />
          </>
        }
      />

      <StatRow>
        <Stat size="lg" label={el.account.balanceToday} value={formatMoney(balance)} />
        <Stat label={`${el.account.monthIn} · ${monthLabel(statMonth)}`} value={formatMoney(stat.inflow)} />
        <Stat label={`${el.account.monthOut} · ${monthLabel(statMonth)}`} value={formatMoney(stat.outflow)} />
      </StatRow>

      <BalanceChecks accountId={id} checks={checks} isCash={account.kind === "cash"} today={todayAthens()} />

      <section className="flex flex-col gap-3">
        <SectionHeader title={el.account.last12} />
        <LedgerChart data={chart} inflowLabel={el.account.inflow} outflowLabel={el.account.outflow} label={el.account.last12} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader
          title={
            <>
              {el.account.ledger} <span className="num text-muted">({total})</span>
            </>
          }
          actions={<MonthFilter accountId={id} month={month} options={monthOptions} />}
        />

        {total === 0 && !showOpening ? (
          <EmptyState title={el.account.noRows} />
        ) : (
          <SpecTable label={el.account.ledger} tableClassName="block md:table">
            <thead className="hidden md:table-header-group">
              <tr>
                <Th className="w-28">{el.transaction.date}</Th>
                <Th>{el.transaction.description}</Th>
                <Th numeric>{el.transaction.amount}</Th>
                <Th numeric>{el.account.runningBalance}</Th>
              </tr>
            </thead>
            <tbody className="block border-t border-rule md:table-row-group md:border-t-0">
              {(ledger ?? []).map((r) => {
                const running = Number(r.running_balance);
                return (
                  <Tr
                    key={r.transaction_id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b border-hairline py-3 md:table-row md:border-b-0 md:py-0"
                  >
                    <Td className={cn(CELL, "col-start-1 row-start-2 max-md:text-small max-md:text-muted md:whitespace-nowrap")}>
                      <span className="num">{formatDate(r.paid_date)}</span>
                    </Td>
                    <Td className={cn(CELL, "col-start-1 row-start-1 min-w-0 [overflow-wrap:anywhere]")}>
                      <Link href={`/transactions?ids=${r.transaction_id}`} className={LINK_CLASS}>
                        {r.party_name || r.description || "—"}
                      </Link>
                      {r.party_name && r.description && <span className={SUB_CLASS}>{r.description}</span>}
                    </Td>
                    <Td numeric strong className={cn(CELL, "col-start-2 row-start-1")}>
                      <Amount value={Number(r.signed_amount)} />
                    </Td>
                    <Td
                      numeric
                      className={cn(CELL, "col-start-2 row-start-2 max-md:text-small", running < 0 ? "text-negative" : "max-md:text-muted")}
                    >
                      {formatMoney(running)}
                    </Td>
                  </Tr>
                );
              })}
              {showOpening && (
                <Tr className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b border-hairline py-3 md:table-row md:border-b-0 md:py-0">
                  <Td className={cn(CELL, "col-start-1 row-start-2 max-md:text-small max-md:text-muted md:whitespace-nowrap")}>
                    <span className="num">{formatDate(account.opening_balance_date)}</span>
                  </Td>
                  <Td className={cn(CELL, "col-start-1 row-start-1 text-muted")}>{el.account.opening}</Td>
                  <Td className="hidden md:table-cell" />
                  <Td numeric className={cn(CELL, "col-start-2 row-start-2 max-md:text-small max-md:text-muted")}>
                    {formatMoney(Number(account.opening_balance))}
                  </Td>
                </Tr>
              )}
            </tbody>
          </SpecTable>
        )}

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          noun={el.account.movements}
          basePath={`/accounts/${id}`}
          params={{ ...sp }}
          label={el.account.ledgerPages}
        />
      </section>
    </div>
  );
}
