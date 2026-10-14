import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { formatDate, formatMoney, formatSignedMoney, moneyOrDash } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { figureFit, LINK_CLASS, PageHeader, SectionHeader, SpecTable, Stat, StatRow, Td, Th, Tr } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/client";
import { rankAttention } from "@/lib/dashboard/attention";
import { DashboardSummary } from "./DashboardSummary";
import { AskAssistantCard } from "./AskAssistantCard";
import { addDays, longDateLabel, todayAthens } from "@/lib/dates";
import {
  dashboardPortfolio,
  overdueObligations,
  overviewGlance,
  planVerdict,
  upcomingObligations,
  UPCOMING_DAYS,
  vatNext,
  vatPosition,
  type GlanceFigure,
  type PlanVerdict,
  type UpcomingItem,
} from "@/lib/dashboard/overview";
import { portfolioRows } from "@/lib/finance/portfolio";
import { loadPendingCaptures } from "@/lib/ingest/pendingCaptures";

// Επισκόπηση (the workbook's «Κέντρο Ελέγχου» and «Πληρωμές»), the answer first:
// «Βγαίνει το πλάνο;» from the 12-month forecast, then Ρευστότητα (a card
// per account, the total dark), what needs attention beside what falls due in
// the next 30 days, the project portfolio, the Θέση ΦΠΑ, the AI. Every figure
// reads from the SQL views (0011_views.sql and later), never from a
// hand-maintained rollup, so it can never drift from the ledger.
// Server-rendered only: no client JS beyond the opt-in AI summary.
//
// View columns are all nullable (Postgres views carry no NOT NULL
// guarantees even when the underlying table does), so every read here goes
// through `?? 0` / `?? ""` rather than assuming a value is present.
export default async function DashboardPage() {
  // Cached per request: the layout already asked.
  const access = await getAccessContext();
  if (access.kind !== "internal") redirect("/login");
  const orgId = access.membership.orgId;
  // Viewers can't review: the menu hides Εισερχόμενα, so does this page.
  const canReview = access.membership.role !== "viewer";
  const supabase = await createClient();

  // v_vat_position only has a row for months with actual transactions, and
  // "most recent row" naively includes FUTURE scheduled months -- a
  // scheduled transaction dated next year would otherwise outrank every
  // real period and show as "current month" with misleading zeros. Pin to
  // the latest period that isn't in the future.
  const todayIso = todayAthens();
  const upcomingEnd = addDays(todayIso, UPCOMING_DAYS - 1);

  const [
    { data: projects },
    { data: vat },
    { data: openTx },
    { data: vatPeriods },
    { count: missingProjectOrAccount },
    pendingCaptures,
    { count: pendingChanges },
    { data: liquidAccounts },
    { data: accountRows },
    { data: forecast },
    { data: pnlRows },
  ] = await Promise.all([
    // One read for both the portfolio table and «εκτός προϋπολογισμού».
    supabase
      .from("v_project_rollup")
      .select(
        "project_id, display_name, code, business_line, status, total_budget, spent, remaining_budget, net_result, capex_paid, capex_committed, vat_on_expenses",
      )
      .eq("org_id", orgId)
      .order("code"),
    supabase
      .from("v_vat_position")
      .select("period_start, payable_after_credit, credit_balance, filing_deadline, vat_income, vat_expense")
      .eq("org_id", orgId)
      .lte("period_start", todayIso)
      .order("period_start", { ascending: false }),
    // Open rows, one read for two blocks: every pending one (receivables/
    // payables, as in v_net_worth_items) plus scheduled ones due up to 30
    // days ahead. Past their due date they are «ληξιπρόθεσμες» (attention),
    // ahead of it «Προσεχείς υποχρεώσεις». An upcoming loan or installment
    // payment must never be missed with zero warning anywhere in the app.
    supabase
      .from("transactions")
      .select("id, due_date, status, direction, gross_amount, description, counterparty_name, project_id, account_id")
      .eq("org_id", orgId)
      .in("status", ["pending", "scheduled"])
      .or(`status.eq.pending,due_date.lte.${upcomingEnd}`),
    // Filing status per period, same source /reports/vat uses -- lets the worklist
    // flag a past period nobody has marked as filed yet.
    supabase.from("vat_periods").select("period_start, status").eq("org_id", orgId),
    supabase.from("v_qc_missing_project_or_account").select("transaction_id", { count: "exact", head: true }).eq("org_id", orgId),
    loadPendingCaptures(supabase, orgId),
    supabase.from("agent_changes").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["pending", "conflict"]),
    // Liquid accounts, same balance rule as v_liquidity (0066), in the order
    // /accounts lists them; is_active only to hide a closed, empty one. The
    // 12-month forecast from the same cash_forecast() /reports/cash shows.
    supabase
      .from("v_account_balances")
      .select("account_id, name, current_balance")
      .eq("org_id", orgId)
      .eq("is_liquid", true)
      .order("owner_scope")
      .order("name"),
    supabase.from("accounts").select("id, name, is_active").eq("org_id", orgId),
    supabase.rpc("cash_forecast", { p_org: orgId, p_months: 12 }),
    // Result figure: the year so far, same function and defaults as /reports/pnl.
    supabase.rpc("pnl_summary", { p_org: orgId, p_from: `${todayIso.slice(0, 4)}-01-01`, p_to: todayIso }),
  ]);

  const inactive = new Set((accountRows ?? []).filter((a) => a.is_active === false).map((a) => a.id));
  const lowest = (forecast ?? []).reduce<NonNullable<typeof forecast>[number] | null>(
    (min, m) => (!min || Number(m.closing_balance) < Number(min.closing_balance) ? m : min),
    null,
  );

  // Names for the small «έργο · λογαριασμός» line under each payment.
  const names = {
    projects: new Map((projects ?? []).map((p) => [p.project_id ?? "", p.display_name ?? ""])),
    accounts: new Map((accountRows ?? []).map((a) => [a.id, a.name])),
  };
  const overdue = overdueObligations(openTx ?? [], todayIso, names);
  const upcoming = upcomingObligations(openTx ?? [], todayIso, undefined, names);

  // Projects with an actual budget whose capex has run past it --
  // v_project_rollup.remaining_budget already accounts for capex-only
  // consumption (0020_cost_treatment.sql), so a negative value here is real.
  const overBudgetProjects = portfolioRows(projects ?? []).filter((p) => p.overBudget);
  const portfolio = dashboardPortfolio(projects ?? []);

  // A past period with no vat_periods row at all, or one whose status is
  // neither 'filed' nor 'paid', hasn't been dealt with -- same definition
  // /reports/vat uses for its badge.
  const filedPeriods = new Set(
    (vatPeriods ?? []).filter((p) => p.status === "filed" || p.status === "paid").map((p) => p.period_start),
  );
  const unfiledVatPeriods = (vat ?? []).filter((v) => v.period_start && !filedPeriods.has(v.period_start));

  // Tax risk: paid business expenses above the threshold with no invoice (or
  // paid in cash) -- v_qc_uninvoiced_large_expenses (0029). Shown as money
  // lost, not a row count: that's the number that makes someone chase the invoice.
  // Where the ledger and reality disagree (or the app is blind): warned about,
  // never silently "fixed" by editing opening balances -- v_qc_account_drift /
  // v_qc_counterparty_without_contact (0033).
  const [{ data: uninvoiced }, { data: accountIssues }, { data: contactless }, { data: lowestItems }, { count: expectedOverdue }] =
    await Promise.all([
      supabase.from("v_qc_uninvoiced_large_expenses").select("lost_deduction_est, lost_input_vat_est").eq("org_id", orgId),
      supabase.from("v_qc_account_drift").select("account_name, drift, issue, days_since_count").eq("org_id", orgId),
      supabase.from("v_qc_counterparty_without_contact").select("n").eq("org_id", orgId),
      // Why the low point is low: that month's largest outflow.
      lowest
        ? supabase
            .rpc("cash_forecast_items", { p_org: orgId, p_month: lowest.month })
            .eq("direction", "expense")
            .order("amount", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: [] as { label: string | null; amount: number }[] }),
      // Expected income still "expected" after its month: the forecast keeps
      // counting it, so the owner should mark it received or move it.
      supabase
        .from("expected_income")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "expected")
        .lt("expected_month", `${todayIso.slice(0, 7)}-01`),
    ]);
  const uninvoicedLost = (uninvoiced ?? []).reduce(
    (sum, r) => sum + Number(r.lost_deduction_est ?? 0) + Number(r.lost_input_vat_est ?? 0),
    0,
  );
  const driftAccounts = (accountIssues ?? []).filter((a) => a.issue === "drift");
  const uncountedAccounts = (accountIssues ?? []).length - driftAccounts.length;
  const contactlessRows = (contactless ?? []).reduce((s, r) => s + Number(r.n ?? 0), 0);
  const inboxCount = pendingCaptures.count + (pendingChanges ?? 0);

  const glance = overviewGlance({
    accounts: (liquidAccounts ?? []).map((a) => ({ ...a, active: !inactive.has(a.account_id ?? "") })),
    lowest,
    lowestDriver: lowestItems?.[0] ?? null,
    year: Number(todayIso.slice(0, 4)),
    pnlRows: pnlRows ?? [],
  });
  const verdict = planVerdict(forecast ?? [], lowestItems?.[0] ?? null);
  const vatPos = vatPosition(vat ?? []);
  const vatDue = vatNext(vat ?? [], filedPeriods, todayIso);

  // The single worklist, ranked by severity and capped
  // (lib/dashboard/attention.ts), so a zero-item list is a real, trustworthy
  // "nothing needs you today".
  // The forecast's verdict is the banner above and the overdue payments are
  // listed in «Πληρωμές», so neither is repeated here.
  const attention = rankAttention([
    (expectedOverdue ?? 0) > 0 && {
      kind: "expectedOverdue",
      label: `${expectedOverdue} αναμενόμεν${expectedOverdue === 1 ? "ο έσοδο έχει" : "α έσοδα έχουν"} περάσει την ημερομηνία ${expectedOverdue === 1 ? "του" : "τους"}`,
      href: "/accounts/expected",
    },
    // Captures waiting on review and AI proposals: one row, one place.
    canReview && inboxCount > 0 && { kind: "inbox", label: `Εισερχόμενα: ${inboxCount} προς έλεγχο`, href: "/inbox" },
    unfiledVatPeriods.length > 0 && {
      kind: "vatUnfiled",
      label: `${unfiledVatPeriods.length} περίοδ${unfiledVatPeriods.length === 1 ? "ος ΦΠΑ" : "οι ΦΠΑ"} χωρίς υποβολή`,
      href: "/reports/vat",
    },
    ...driftAccounts.map((a) => ({
      kind: "accountDrift" as const,
      label: `${a.account_name}: λείπουν ${Number(a.drift) < 0 ? "έξοδα" : "έσοδα"} ${formatMoney(Math.abs(Number(a.drift)))} (έλεγχος με πραγματικό υπόλοιπο)`,
      href: "/accounts",
    })),
    overBudgetProjects.length > 0 && {
      kind: "overBudget",
      label: `${overBudgetProjects.length} έργ${overBudgetProjects.length === 1 ? "ο εκτός" : "α εκτός"} προϋπολογισμού · ${overBudgetProjects.map((p) => p.name).join(", ")}`,
      href: `/projects/${overBudgetProjects[0].id}`,
    },
    (uninvoiced ?? []).length > 0 && {
      kind: "uninvoiced",
      label: `${(uninvoiced ?? []).length} δαπάνες χωρίς παραστατικό — ~${formatMoney(uninvoicedLost)} φόρος & ΦΠΑ που χάνονται`,
      href: "/reports/quality",
    },
    uncountedAccounts > 0 && {
      kind: "uncountedAccounts",
      label: `${uncountedAccounts} ${uncountedAccounts === 1 ? "λογαριασμός" : "λογαριασμοί"} χωρίς μέτρηση υπολοίπου τον τελευταίο μήνα`,
      href: "/accounts",
    },
    contactlessRows > 0 && {
      kind: "contactless",
      label: `${contactlessRows} ${contactlessRows === 1 ? "κίνηση" : "κινήσεις"} με αντισυμβαλλόμενο χωρίς επαφή`,
      href: "/reports/quality",
    },
    (missingProjectOrAccount ?? 0) > 0 && {
      kind: "missingProjectOrAccount",
      label: `${missingProjectOrAccount} ${missingProjectOrAccount === 1 ? "κίνηση" : "κινήσεις"} χωρίς έργο/λογαριασμό`,
      href: "/reports/quality",
    },
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={longDateLabel(todayIso)} title={el.nav.dashboard} />

      {/* 1 · The answer first: does the 12-month plan hold? */}
      {verdict && <VerdictBanner verdict={verdict} />}

      {/* 2 · Ρευστότητα: one card per liquid account, the total in the dark card */}
      <section aria-labelledby="liquidity" className="flex flex-col gap-3">
        <SectionHeader
          title={<span id="liquidity">Ρευστότητα</span>}
          actions={
            <Link href={glance.pnl.href} className={`inline-flex min-h-11 items-center gap-1.5 text-body ${LINK_CLASS}`}>
              {glance.pnl.label}: <span className={`num ${glance.pnl.negative ? "text-negative" : ""}`}>{glance.pnl.value}</span> →
            </Link>
          }
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {glance.figures.map((f) => (
            <AccountCard key={f.key} figure={f} />
          ))}
        </div>
      </section>

      {/* What to act on, side by side on a wide screen: the worklist and what falls due. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* 3 · Χρειάζεται προσοχή */}
        <section className="flex min-w-0 flex-col">
          <SectionHeader title="Χρειάζεται Προσοχή" />
          {attention.shown.length === 0 ? (
            <p className="border-b border-hairline py-3 text-body text-muted">Τίποτα δεν χρειάζεται προσοχή αυτή τη στιγμή.</p>
          ) : (
            <ul className="flex flex-col">
              {attention.shown.map((item) => (
                <li key={item.href + item.label} className="border-b border-hairline">
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center justify-between gap-3 border-l-2 border-negative py-2 pr-2 pl-4 text-body text-ink transition-colors hover:bg-hover"
                  >
                    <span>{item.label}</span>
                    <span aria-hidden="true" className="shrink-0 text-muted">
                      →
                    </span>
                  </Link>
                </li>
              ))}
              {attention.more > 0 && (
                <li className="flex min-h-11 flex-wrap items-center gap-x-4 border-b border-hairline py-2 pr-2 pl-4 text-body text-muted">
                  <span>+{attention.more} ακόμα</span>
                  <Link href="/reports/quality" className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:underline">
                    όλα →
                  </Link>
                  {canReview && (
                    <Link href="/inbox" className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:underline">
                      Εισερχόμενα →
                    </Link>
                  )}
                </li>
              )}
            </ul>
          )}
        </section>

        {/* 4 · Πληρωμές: what is overdue (oldest first), then what falls due */}
        <section aria-labelledby="payments" className="flex min-w-0 flex-col gap-4">
          <SectionHeader
            title={<span id="payments">Πληρωμές</span>}
            actions={
              <Link href="/calendar" className={`inline-flex min-h-11 items-center text-body ${LINK_CLASS}`}>
                Ημερολόγιο →
              </Link>
            }
          />

          {overdue.shown.length > 0 && (
            <div className="flex flex-col">
              <h3 className="flex items-baseline justify-between gap-3 border-b border-negative pb-2 text-body font-medium text-negative">
                <span>Ληξιπρόθεσμα · {overdue.shown.length + overdue.more}</span>
                <span className="num">{formatSignedMoney(overdue.total)}</span>
              </h3>
              <ObligationRows label="Ληξιπρόθεσμες πληρωμές" items={overdue.shown} overdue />
              {overdue.more > 0 && (
                <Link
                  href={`/transactions?ids=${overdue.ids.join(",")}`}
                  className={`inline-flex min-h-11 items-center text-body ${LINK_CLASS}`}
                >
                  +{overdue.more} ακόμα · όλες →
                </Link>
              )}
            </div>
          )}

          <div className="flex flex-col">
            <h3 className="flex items-baseline justify-between gap-3 border-b border-rule pb-2 text-body font-medium text-ink">
              <span>Επόμενες {UPCOMING_DAYS} ημέρες</span>
              {upcoming.shown.length > 0 && <span className="num">{formatSignedMoney(upcoming.income + upcoming.outflow)}</span>}
            </h3>
            {upcoming.shown.length === 0 ? (
              <p className="py-2 text-body text-muted">Τίποτα δεν λήγει τις επόμενες {UPCOMING_DAYS} ημέρες.</p>
            ) : (
              <>
                <ObligationRows label="Προσεχείς πληρωμές" items={upcoming.shown} />
                <p className="flex min-h-11 flex-wrap items-center gap-x-4 text-small text-muted">
                  <span>
                    Εισπράξεις {formatSignedMoney(upcoming.income)} · Πληρωμές {formatSignedMoney(upcoming.outflow)}
                  </span>
                  {upcoming.more > 0 && (
                    <Link href="/calendar" className={`inline-flex min-h-11 items-center text-body ${LINK_CLASS}`}>
                      +{upcoming.more} ακόμα →
                    </Link>
                  )}
                </p>
              </>
            )}
          </div>
        </section>

      </div>

      {/* 5 · Χαρτοφυλάκιο έργων */}
      <section aria-labelledby="portfolio" className="flex flex-col gap-2">
        <SectionHeader
          title={<span id="portfolio">Χαρτοφυλάκιο Έργων</span>}
          actions={
            <Link href="/reports/portfolio" className={`inline-flex min-h-11 items-center text-body ${LINK_CLASS}`}>
              {portfolio.more > 0 ? `όλα (${portfolio.shown.length + portfolio.more}) →` : "Αναφορά →"}
            </Link>
          }
        />
        {portfolio.shown.length === 0 ? (
          <p className="py-2 text-body text-muted">Δεν υπάρχουν ακόμα έργα με προϋπολογισμό ή δαπάνες.</p>
        ) : (
          <SpecTable label="Χαρτοφυλάκιο έργων" stickyFirst>
            <thead>
              <tr>
                <Th>Έργο</Th>
                <Th numeric className="hidden sm:table-cell">
                  {el.project.budget}
                </Th>
                <Th numeric className="hidden sm:table-cell">
                  Υπόλοιπο
                </Th>
                <Th numeric>{el.projectPage.budget.paid}</Th>
                <Th numeric>{el.projectPage.budget.committed}</Th>
                <Th numeric className="hidden sm:table-cell">
                  + ΦΠΑ
                </Th>
              </tr>
            </thead>
            <tbody>
              {portfolio.shown.map((p) => (
                <Tr key={p.id}>
                  <Td strong>
                    <Link href={`/projects/${p.id}`} className={LINK_CLASS}>
                      {p.name}
                    </Link>
                    {p.overBudget && <span className="block text-small text-negative">εκτός προϋπολογισμού</span>}
                  </Td>
                  <Td numeric className="hidden sm:table-cell">
                    {p.budget === null ? <span className="text-muted">—</span> : formatMoney(p.budget)}
                  </Td>
                  <Td numeric className={`hidden sm:table-cell ${p.remaining !== null && p.remaining < 0 ? "text-negative" : ""}`}>
                    {p.remaining === null ? <span className="text-muted">—</span> : formatMoney(p.remaining)}
                  </Td>
                  <Td numeric>
                    <Link href={`/transactions?project_id=${p.id}&direction=expense&status=paid`} className={LINK_CLASS}>
                      {moneyOrDash(p.paid)}
                    </Link>
                  </Td>
                  <Td numeric>
                    <Link href={`/transactions?project_id=${p.id}&direction=expense&status=pending`} className={LINK_CLASS}>
                      {moneyOrDash(p.committed)}
                    </Link>
                  </Td>
                  <Td numeric className="hidden sm:table-cell">
                    <Link href={`/transactions?project_id=${p.id}&direction=expense`} className={LINK_CLASS}>
                      {moneyOrDash(p.vat)}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </SpecTable>
        )}
      </section>

      {/* 6 · Θέση ΦΠΑ: four figures on one row */}
      <section aria-labelledby="vat" className="flex flex-col">
        <SectionHeader
          title={<span id="vat">Θέση ΦΠΑ</span>}
          actions={
            <Link href="/reports/vat" className={`inline-flex min-h-11 items-center text-body ${LINK_CLASS}`}>
              Ανά περίοδο →
            </Link>
          }
        />
        {vatPos ? (
          <>
            <StatRow className="border-t-0 py-3">
              <Link href={`/transactions?direction=income&from=${vatPos.from}`} className="group min-h-11 hover:bg-hover">
                <Stat label="ΦΠΑ εκροών (σύνολο)" value={formatMoney(vatPos.output)} />
              </Link>
              <Link href={`/transactions?direction=expense&from=${vatPos.from}`} className="group min-h-11 hover:bg-hover">
                <Stat label="ΦΠΑ εισροών (σύνολο)" value={formatMoney(vatPos.input)} />
              </Link>
              <Stat label="Τρέχον πιστωτικό" value={formatMoney(vatPos.credit)} />
              <Stat label="Οφειλόμενο τώρα" value={formatMoney(vatPos.owed)} />
            </StatRow>
            <p className="pt-2 text-small text-muted" title="Εκροές/εισροές: όλες οι περίοδοι· πιστωτικό και οφειλόμενο: η τρέχουσα θέση.">
              Επόμενη υποβολή: {formatMoney(vatDue.payable)} · {vatDue.sub}
            </p>
          </>
        ) : (
          <p className="py-2 text-body text-muted">Δεν υπάρχουν ακόμα κινήσεις με ΦΠΑ.</p>
        )}
      </section>

      {/* 7 · Kansha AI */}
      {aiEnabled() && (
        <section aria-label={el.nav.assistant} className="flex flex-col gap-3">
          <AskAssistantCard />
          <DashboardSummary />
        </section>
      )}
    </div>
  );
}

// «Βγαίνει το πλάνο;»: one sentence and the low point, the whole banner the
// link to that month in Ταμείο & Πρόβλεψη; why it is low on hover.
const VERDICT_TONE = {
  ok: "border-positive bg-positive-tint text-positive",
  tight: "border-warning bg-warning-tint text-warning",
  short: "border-negative bg-negative-tint text-negative",
} as const;

function VerdictBanner({ verdict }: { verdict: PlanVerdict }) {
  return (
    <Link
      href={verdict.href}
      title={verdict.why ?? undefined}
      className={`group flex min-h-11 flex-col gap-1 border-l-4 px-5 py-4 transition-colors hover:brightness-[0.98] ${VERDICT_TONE[verdict.tone]}`}
    >
      <span className="eyebrow">Βγαίνει το πλάνο; · επόμενοι 12 μήνες</span>
      <span className="heading text-section">
        {verdict.tone === "ok" ? "✓ " : "⚠ "}
        {verdict.title}
      </span>
      <span className="text-body text-text">
        {verdict.detail}{" "}
        <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </Link>
  );
}

// One Ρευστότητα card: the account name, a tabular value; the whole card is
// the link to its transactions. The total is the dark card.
function AccountCard({ figure }: { figure: GlanceFigure }) {
  return (
    <Link
      href={figure.href}
      className={`group @container flex min-h-11 min-w-0 flex-col gap-1 border px-4 py-3 transition-colors ${
        figure.total ? "border-panel bg-panel text-panel-ink" : "border-hairline bg-raised hover:bg-hover"
      }`}
    >
      <span className={`text-small break-words ${figure.total ? "text-panel-muted" : "text-muted"}`}>{figure.label}</span>
      <span
        className={`num [overflow-wrap:anywhere] ${figureFit(figure.length, "md")} ${
          figure.total ? "text-panel-ink" : figure.negative ? "text-negative" : "text-ink"
        }`}
      >
        {figure.value}
      </span>
    </Link>
  );
}

// One payment per row: due date | what it is, with «έργο · λογαριασμός»
// under it | signed amount. The description is the link to the row.
function ObligationRows({ label, items, overdue = false }: { label: string; items: UpcomingItem[]; overdue?: boolean }) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {items.map((u) => (
        <li key={u.id} className="flex min-h-11 items-baseline gap-3 border-b border-hairline py-2">
          <span className={`num w-24 shrink-0 text-small ${overdue ? "text-negative" : "text-muted"}`}>{formatDate(u.date)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <Link href={`/transactions?ids=${u.id}`} title={u.label} className={`truncate text-body text-ink ${LINK_CLASS}`}>
              {u.label}
            </Link>
            {u.meta && <span className="truncate text-small text-muted">{u.meta}</span>}
          </span>
          <span className="num shrink-0 text-body text-ink">{formatSignedMoney(u.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
