import Link from "next/link";
import { Badge, DataTable, EmptyState, KeyValue, SectionHeader } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { addMonths, currentMonthKey, firstOfMonth, monthsBetween, shortMonthYearLabel } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import {
  deleteCapitalSource,
  deleteLoan,
  deleteUtility,
  saveCapitalSource,
  saveLoan,
  saveProjectBudget,
  saveUtility,
} from "@/app/(app)/projects/[id]/finance-actions";
import { BudgetFields, CapitalFields, CAPITAL_KIND_LABELS, LoanFields, LOAN_STATE_LABELS, UtilityFields, UTILITY_KIND_LABELS } from "./forms/fields";
import { DrawerButton } from "./DrawerButton";
import { ActionButton } from "./ActionButton";
import { CostChart } from "./CostChart";
import { money0, percent } from "./format";
import { requireTab } from "./data";

const t = projects.finance;
const LINE_ORDER = ["acquisition", "studies_permits_legal", "construction_equipment", "other", "contingency"];

// Οικονομικά: one home for each money fact of the project -- budget vs
// actual (v_project_budget_lines, with the contingency row), development
// and sale, loans, capital, and the cost of using the property. Read
// first; every edit opens a drawer.
export async function FinanceTab({ id }: { id: string }) {
  const core = await requireTab(id, "finance");
  const { supabase, rollup, inputs, canEdit, budget, development } = core;
  const twelveAgo = addMonths(currentMonthKey(), -11);

  const [{ data: lines }, { data: income }, { data: utilities }, { data: costRows }, { data: settlements }] = await Promise.all([
    supabase.from("v_project_budget_lines").select("line_code, label, budget, paid, committed, remaining").eq("project_id", id),
    supabase.from("transactions").select("gross_amount").eq("project_id", id).eq("direction", "income").eq("status", "paid"),
    supabase.from("property_utilities").select("*").eq("project_id", id).order("kind"),
    supabase.from("v_property_monthly_cost").select("month, paid_amount").eq("project_id", id).gte("month", firstOfMonth(twelveAgo)),
    supabase
      .from("installment_plans")
      .select("label, amount_per_installment, installment_count, first_due_date")
      .eq("project_id", id)
      .eq("obligation_kind", "third_party_tax_settlement")
      .order("amount_per_installment", { ascending: false }),
  ]);

  const budgetRows = (lines ?? [])
    .filter((r) => Number(r.budget ?? 0) !== 0 || Number(r.paid ?? 0) + Number(r.committed ?? 0) !== 0)
    .sort((a, b) => LINE_ORDER.indexOf(a.line_code ?? "") - LINE_ORDER.indexOf(b.line_code ?? ""));
  const sum = (f: (r: (typeof budgetRows)[number]) => number) => budgetRows.reduce((s, r) => s + f(r), 0);
  const spentOf = (r: (typeof budgetRows)[number]) => Number(r.paid ?? 0) + Number(r.committed ?? 0);
  const budgetLines = budget?.budget_lines ?? [];
  const budgetInitial = budget
    ? { contingency_pct: Number(budget.contingency_pct ?? 0), lines: Object.fromEntries(budgetLines.map((l) => [l.line_code, Number(l.amount)])) }
    : undefined;
  const outside = [
    { label: t.occupancy, amount: Number(rollup.occupancy_cost ?? 0) },
    { label: t.otherOpex, amount: Number(rollup.other_opex ?? 0) },
    { label: t.unclassified, amount: Number(rollup.unclassified_spend ?? 0), note: t.unclassifiedNote },
  ].filter((r) => r.amount > 0);

  const loans = inputs.loans;
  const totals = inputs.loanSchedule?.totals;
  const revenueToDate = (income ?? []).reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
  const byKind = core.capitalRows.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] ?? 0) + c.amount }), {});

  const monthlyRent = inputs.leaseSchedule?.rows[0]?.monthlyAmount ?? 0;
  const settlementMonthly = (settlements ?? []).reduce((s, p) => s + Number(p.amount_per_installment ?? 0), 0);
  const costByMonth = new Map<string, number>();
  for (const r of costRows ?? []) if (r.month) costByMonth.set(r.month.slice(0, 7), (costByMonth.get(r.month.slice(0, 7)) ?? 0) + Number(r.paid_amount ?? 0));
  const months = monthsBetween(twelveAgo, currentMonthKey()).map((m) => ({ month: shortMonthYearLabel(m), paid: costByMonth.get(m) ?? 0 }));

  let n = 0;
  const num = () => ++n;

  return (
    <div className="flex flex-col gap-12">
      {/* Budget vs actual */}
      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={num()}
          title={t.budget}
          actions={
            canEdit && (
              <DrawerButton label={budget ? t.editBudget : t.addBudget} title={projects.header.budgetTitle} action={saveProjectBudget.bind(null, id)}>
                <BudgetFields initial={budgetInitial} />
              </DrawerButton>
            )
          }
        />
        {core.hasBudget ? (
          <DataTable
            rows={budgetRows}
            rowKey={(r) => r.line_code ?? r.label ?? ""}
            columns={[
              {
                key: "line",
                header: t.line,
                primary: true,
                cell: (r) => r.label || el.budgetLines[(r.line_code ?? "other") as keyof typeof el.budgetLines] || r.line_code,
              },
              { key: "budget", header: t.planned, numeric: true, cell: (r) => formatMoney(r.budget) },
              { key: "spent", header: t.spent, numeric: true, cell: (r) => formatMoney(spentOf(r)) },
              {
                key: "remaining",
                header: t.remaining,
                numeric: true,
                cell: (r) => <span className={Number(r.remaining ?? 0) < 0 ? "text-negative" : undefined}>{formatMoney(r.remaining)}</span>,
              },
            ]}
            totals={{
              budget: formatMoney(sum((r) => Number(r.budget ?? 0))),
              spent: formatMoney(sum(spentOf)),
              remaining: formatMoney(sum((r) => Number(r.remaining ?? 0))),
            }}
            caption={budgetRows.some((r) => r.line_code === "contingency") ? el.budgetLines.contingencyNote : undefined}
          />
        ) : (
          <EmptyState title={t.noBudget} body={t.noBudgetBody} />
        )}
        {outside.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="eyebrow text-muted">{t.outside}</p>
            <KeyValue
              columns={2}
              items={outside.map((r) => ({
                label: r.note ? `${r.label} — ${r.note}` : r.label,
                value: formatMoney(r.amount),
                numeric: true,
              }))}
            />
          </div>
        )}
      </section>

      {/* Development and sale */}
      {rollup.business_model === "own_development" && (
        <section className="flex flex-col gap-4">
          <SectionHeader numeral={num()} title={el.development.title} />
          <p className="max-w-prose text-small text-muted">{el.development.subtitle}</p>
          <KeyValue
            columns={2}
            items={[
              { label: el.development.revenue, value: formatMoney(development.revenue), numeric: true },
              { label: el.development.cost, value: `−${formatMoney(development.cost)}`, numeric: true },
              { label: el.development.margin, value: formatMoney(development.margin), numeric: true },
              { label: el.development.marginPct, value: percent(development.marginPct), numeric: true },
              {
                label: el.development.peak,
                value: (
                  <>
                    {formatMoney(development.peakFunding)}
                    {development.peakFundingDate && <span className="block text-small text-muted">{formatDate(development.peakFundingDate)}</span>}
                  </>
                ),
                numeric: true,
              },
              { label: <span title={el.development.irrHint}>{el.development.irr}</span>, value: percent(development.irr), numeric: true },
            ]}
          />
          {core.flowsTruncated && <p className="border-l-2 border-warning pl-3 text-small text-warning">{el.development.truncated}</p>}
        </section>
      )}

      {/* Loans */}
      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={num()}
          title={t.loans}
          actions={
            canEdit && (
              <DrawerButton label={t.addLoan} title={t.loanTitle} action={saveLoan.bind(null, id, null)}>
                <LoanFields />
              </DrawerButton>
            )
          }
        />
        {totals && loans.length > 0 && (
          <KeyValue
            columns={2}
            items={[
              { label: t.monthly, value: formatMoney(totals.monthlyInstalment), numeric: true },
              { label: t.annualService, value: formatMoney(totals.annualDebtService), numeric: true },
              { label: t.gracePre, value: formatMoney(totals.graceInterestPreOpening), numeric: true },
              { label: t.gracePost, value: formatMoney(totals.graceInterestPostOpening), numeric: true },
              { label: t.totalInterest, value: formatMoney(totals.totalInterest), numeric: true },
              { label: t.totalCost, value: formatMoney(totals.totalCost), numeric: true },
            ]}
          />
        )}
        <DataTable
          rows={loans}
          rowKey={(l) => l.id}
          empty={t.noLoans}
          columns={[
            {
              key: "label",
              header: t.tranche,
              primary: true,
              cell: (l) =>
                canEdit ? (
                  <DrawerButton asLink label={l.label} title={t.loanTitle} eyebrow={l.label} action={saveLoan.bind(null, id, l.id)}>
                    <LoanFields
                      initial={{
                        ...l,
                        drawdowns: (l.loan_drawdowns ?? []).map((d) => ({
                          scheduled_month: d.scheduled_month,
                          amount: Number(d.actual_amount ?? d.amount),
                          done: d.actual_date != null,
                        })),
                      }}
                    />
                  </DrawerButton>
                ) : (
                  l.label
                ),
            },
            { key: "state", header: t.state, cell: (l) => <Badge>{LOAN_STATE_LABELS[l.state]}</Badge> },
            { key: "principal", header: t.principal, numeric: true, cell: (l) => formatMoney(l.principal) },
            { key: "rate", header: t.rate, numeric: true, cell: (l) => percent(Number(l.interest_rate)) },
            { key: "term", header: t.term, numeric: true, cell: (l) => `${l.term_years} ${t.years}` },
          ]}
          totals={loans.length > 1 ? { principal: formatMoney(core.loansTotal) } : undefined}
          rowActions={
            canEdit
              ? (l) => <ActionButton action={deleteLoan.bind(null, id, l.id)} confirm={`${t.delete}: ${l.label};`}>{t.delete}</ActionButton>
              : undefined
          }
        />
      </section>

      {/* Capital */}
      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={num()}
          title={t.capital}
          actions={
            canEdit && (
              <DrawerButton label={t.addCapital} title={t.capitalTitle} action={saveCapitalSource.bind(null, id, null)}>
                <CapitalFields />
              </DrawerButton>
            )
          }
        />
        {core.capitalRows.length > 0 && (
          <KeyValue
            columns={2}
            items={[
              ...Object.entries(byKind).map(([kind, amount]) => ({
                label: CAPITAL_KIND_LABELS[kind as keyof typeof CAPITAL_KIND_LABELS],
                value: formatMoney(amount),
                numeric: true,
              })),
              { label: t.capitalTotal, value: formatMoney(core.capitalTotal), numeric: true },
              {
                label: <Link href={`/transactions?project_id=${id}&direction=income&status=paid`}>{t.revenueToDate}</Link>,
                value: formatMoney(revenueToDate),
                numeric: true,
              },
              { label: <span title={el.development.irrHint}>{el.development.irr}</span>, value: percent(development.irr), numeric: true },
            ]}
          />
        )}
        <DataTable
          rows={core.capitalRows}
          rowKey={(c) => c.id}
          empty={t.noCapital}
          columns={[
            {
              key: "who",
              header: t.contributor,
              primary: true,
              cell: (c) => {
                const label = c.contributor || CAPITAL_KIND_LABELS[c.kind];
                return canEdit ? (
                  <DrawerButton asLink label={label} title={t.capitalTitle} action={saveCapitalSource.bind(null, id, c.id)}>
                    <CapitalFields initial={c} />
                  </DrawerButton>
                ) : (
                  label
                );
              },
            },
            { key: "kind", header: t.kind, cell: (c) => CAPITAL_KIND_LABELS[c.kind] },
            { key: "date", header: t.date, cell: (c) => formatDate(c.contributed_on) },
            { key: "amount", header: t.amount, numeric: true, cell: (c) => formatMoney(c.amount) },
          ]}
          rowActions={canEdit ? (c) => <ActionButton action={deleteCapitalSource.bind(null, id, c.id)} confirm={`${t.delete};`}>{t.delete}</ActionButton> : undefined}
        />
      </section>

      {/* Cost of use: utilities + what the property costs each month */}
      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={num()}
          title={t.usage}
          actions={
            canEdit && (
              <DrawerButton label={t.addUtility} title={t.utilityTitle} action={saveUtility.bind(null, id, null)}>
                <UtilityFields />
              </DrawerButton>
            )
          }
        />
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-muted">{t.utilities}</p>
            <DataTable
              rows={utilities ?? []}
              rowKey={(u) => u.id}
              empty={t.noUtilities}
              columns={[
                {
                  key: "kind",
                  header: t.kind,
                  primary: true,
                  cell: (u) =>
                    canEdit ? (
                      <DrawerButton asLink label={UTILITY_KIND_LABELS[u.kind]} title={t.utilityTitle} action={saveUtility.bind(null, id, u.id)}>
                        <UtilityFields initial={u} />
                      </DrawerButton>
                    ) : (
                      UTILITY_KIND_LABELS[u.kind]
                    ),
                },
                { key: "provider", header: t.provider, cell: (u) => u.provider ?? "—" },
                { key: "supply", header: t.supply, cell: (u) => <span className="num">{u.supply_number ?? "—"}</span> },
                { key: "rf", header: t.rf, cell: (u) => <span className="num">{u.rf_code ?? ""}</span>, hideOnCard: true },
              ]}
              rowActions={canEdit ? (u) => <ActionButton action={deleteUtility.bind(null, id, u.id)} confirm={`${t.delete};`}>{t.delete}</ActionButton> : undefined}
            />
          </div>
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-muted">{t.runningCost}</p>
            {(monthlyRent > 0 || (settlements ?? []).length > 0) && (
              <KeyValue
                items={[
                  ...(monthlyRent > 0 ? [{ label: t.rent, value: formatMoney(monthlyRent), numeric: true }] : []),
                  ...(settlements ?? []).map((p) => ({
                    label: `${p.label} · ${p.installment_count} δόσεις από ${formatDate(p.first_due_date)}`,
                    value: formatMoney(p.amount_per_installment),
                    numeric: true,
                  })),
                  { label: t.monthTotal, value: money0(monthlyRent + settlementMonthly), numeric: true },
                ]}
              />
            )}
            <CostChart data={months} label={t.last12} series={t.paid} />
            <Link href={`/projects/properties?month=${currentMonthKey()}`} className="text-small text-ink underline-offset-4 hover:underline">
              {t.last12} →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
