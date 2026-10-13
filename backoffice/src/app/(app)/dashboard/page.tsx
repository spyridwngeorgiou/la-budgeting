import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { formatDate, formatMoney, formatSignedMoney, moneyOrDash } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { figureFit, GlancePanel, LINK_CLASS, PageHeader, SectionHeader, SpecTable, Td, Th, Tr } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/client";
import { rankAttention } from "@/lib/dashboard/attention";
import { DashboardSummary } from "./DashboardSummary";
import { AskAssistantCard } from "./AskAssistantCard";
import { addDays, longDateLabel, monthKeyOf, monthLabel, todayAthens } from "@/lib/dates";
import {
  dashboardPortfolio,
  overviewGlance,
  upcomingObligations,
  UPCOMING_DAYS,
  vatLine,
  type GlanceFigure,
} from "@/lib/dashboard/overview";
import { portfolioRows } from "@/lib/finance/portfolio";
import { loadPendingCaptures } from "@/lib/ingest/pendingCaptures";

// Επισκόπηση, in the 7/10 order (the workbook's «Κέντρο Ελέγχου» and
// «Πληρωμές»): what needs attention, Ρευστότητα, what falls due in the next
// 30 days, the project portfolio, the ΦΠΑ line, then the AI. Every figure
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
    { data: liquidity },
    { data: forecast },
    { data: pnlRows },
  ] = await Promise.all([
    // One read for both the portfolio table and «εκτός προϋπολογισμού».
    supabase
      .from("v_project_rollup")
      .select("project_id, display_name, code, business_line, status, total_budget, spent, remaining_budget, net_result, pending, vat_on_expenses")
      .eq("org_id", orgId)
      .order("code"),
    supabase
      .from("v_vat_position")
      .select("period_start, payable_after_credit, credit_balance, filing_deadline")
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
      .select("id, due_date, status, direction, gross_amount, description, counterparty_name")
      .eq("org_id", orgId)
      .in("status", ["pending", "scheduled"])
      .or(`status.eq.pending,due_date.lte.${upcomingEnd}`),
    // Filing status per period, same source /reports/vat uses -- lets the worklist
    // flag a past period nobody has marked as filed yet.
    supabase.from("vat_periods").select("period_start, status").eq("org_id", orgId),
    supabase.from("v_qc_missing_project_or_account").select("transaction_id", { count: "exact", head: true }).eq("org_id", orgId),
    loadPendingCaptures(supabase, orgId),
    supabase.from("agent_changes").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["pending", "conflict"]),
    // Liquid cash (v_liquidity, 0066) and the 12-month forecast from the same
    // cash_forecast() /reports/cash shows -- never re-derived here.
    supabase.from("v_liquidity").select("owner_scope, balance").eq("org_id", orgId),
    supabase.rpc("cash_forecast", { p_org: orgId, p_months: 12 }),
    // Result figure: the year so far, same function and defaults as /reports/pnl.
    supabase.rpc("pnl_summary", { p_org: orgId, p_from: `${todayIso.slice(0, 4)}-01-01`, p_to: todayIso }),
  ]);

  const cashOf = (scope: "corporate" | "personal") =>
    (liquidity ?? []).filter((l) => l.owner_scope === scope).reduce((sum, l) => sum + Number(l.balance ?? 0), 0);
  const lowest = (forecast ?? []).reduce<NonNullable<typeof forecast>[number] | null>(
    (min, m) => (!min || Number(m.closing_balance) < Number(min.closing_balance) ? m : min),
    null,
  );
  const forecastBelow = (forecast ?? []).find((m) => m.below_buffer);
  // "Πληρωτέο" only makes sense as of the latest period: the running balance
  // already carries every prior period forward.
  const currentVat = vat?.[0];

  const overdue = (openTx ?? []).filter((tx) => tx.due_date && tx.due_date < todayIso);
  const upcoming = upcomingObligations(openTx ?? [], todayIso);

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
    cashCorporate: cashOf("corporate"),
    cashPersonal: cashOf("personal"),
    lowest,
    lowestDriver: lowestItems?.[0] ?? null,
    year: Number(todayIso.slice(0, 4)),
    pnlRows: pnlRows ?? [],
    vatPayable: Number(currentVat?.payable_after_credit ?? 0),
  });

  // The single worklist, ranked by severity and capped
  // (lib/dashboard/attention.ts), so a zero-item list is a real, trustworthy
  // "nothing needs you today".
  const attention = rankAttention([
    forecastBelow && {
      kind: "cashBelowBuffer",
      label: `Η πρόβλεψη ταμείου πέφτει κάτω από το απόθεμα ασφαλείας ${monthLabel(monthKeyOf(forecastBelow.month))}`,
      href: "/reports/cash",
    },
    overdue.length > 0 && {
      kind: "overdue",
      label: `${overdue.length} ληξιπρόθεσμ${overdue.length === 1 ? "η υποχρέωση" : "ες υποχρεώσεις"}`,
      href: `/transactions?ids=${overdue.map((tx) => tx.id).join(",")}`,
    },
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
      label: `${overBudgetProjects.length} έργ${overBudgetProjects.length === 1 ? "ο εκτός" : "α εκτός"} προϋπολογισμού`,
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

      {/* 1 · Χρειάζεται προσοχή */}
      <section className="flex flex-col">
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

      {/* 2 · Ρευστότητα */}
      <GlancePanel
        title="Ρευστότητα"
        footer={
          <span className="text-panel-muted">
            Το ταμείο μετρά μόνο ρευστούς λογαριασμούς· χρυσός και crypto εμφανίζονται στην Καθαρή θέση.
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 xl:grid-cols-4 xl:gap-x-0">
          {glance.map((f) => (
            <Figure key={f.key} figure={f} />
          ))}
        </div>
      </GlancePanel>

      {/* 3 · Προσεχείς υποχρεώσεις */}
      <section aria-labelledby="upcoming" className="flex flex-col gap-2">
        <SectionHeader
          title={<span id="upcoming">Προσεχείς Υποχρεώσεις · {UPCOMING_DAYS} ημέρες</span>}
          actions={
            <Link href="/calendar" className={`inline-flex min-h-11 items-center text-body ${LINK_CLASS}`}>
              {upcoming.more > 0 ? `όλες (${upcoming.shown.length + upcoming.more}) →` : "Ημερολόγιο →"}
            </Link>
          }
        />
        {upcoming.shown.length === 0 ? (
          <p className="py-2 text-body text-muted">Τίποτα δεν λήγει τις επόμενες {UPCOMING_DAYS} ημέρες.</p>
        ) : (
          <SpecTable label="Προσεχείς υποχρεώσεις">
            <thead>
              <tr>
                <Th>Λήξη</Th>
                <Th>Περιγραφή</Th>
                <Th numeric>Ποσό</Th>
              </tr>
            </thead>
            <tbody>
              {upcoming.shown.map((u) => (
                <Tr key={u.id}>
                  <Td className="num whitespace-nowrap text-muted">{formatDate(u.date)}</Td>
                  <Td strong>
                    <Link href={`/transactions?ids=${u.id}`} className={LINK_CLASS}>
                      {u.label}
                    </Link>
                  </Td>
                  <Td numeric>{formatSignedMoney(u.amount)}</Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <Tr total>
                <Td>{upcoming.more > 0 ? `Σύνολο (και ${upcoming.more} ακόμα)` : "Σύνολο"}</Td>
                <Td className="text-small font-normal text-muted">
                  Εισπράξεις {formatSignedMoney(upcoming.income)} · Πληρωμές {formatSignedMoney(upcoming.outflow)}
                </Td>
                <Td numeric>{formatSignedMoney(upcoming.income + upcoming.outflow)}</Td>
              </Tr>
            </tfoot>
          </SpecTable>
        )}
      </section>

      {/* 4 · Χαρτοφυλάκιο έργων */}
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
                <Th numeric>Δαπανηθέντα</Th>
                <Th numeric>Εκκρεμούν</Th>
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
                  <Td numeric>
                    <Link href={`/transactions?project_id=${p.id}&direction=expense&status=paid`} className={LINK_CLASS}>
                      {moneyOrDash(p.spent)}
                    </Link>
                  </Td>
                  <Td numeric>
                    <Link href={`/transactions?project_id=${p.id}&direction=expense&status=pending`} className={LINK_CLASS}>
                      {moneyOrDash(p.pending)}
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

      {/* 5 · ΦΠΑ: one line */}
      <Link
        href="/reports/vat"
        className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-y border-hairline py-2 text-body text-ink transition-colors hover:bg-hover"
      >
        <span>
          <span className="eyebrow mr-3 text-muted">ΦΠΑ</span>
          {vatLine(vat ?? [], filedPeriods, todayIso)}
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted">
          →
        </span>
      </Link>

      {/* 6 · Kansha AI */}
      {aiEnabled() && (
        <section aria-label={el.nav.assistant} className="flex flex-col gap-3">
          <AskAssistantCard />
          <DashboardSummary />
        </section>
      )}
    </div>
  );
}

// One Ρευστότητα figure: eyebrow (wraps), big light tabular value, a muted
// line; the whole figure is the link to where the number comes from.
function Figure({ figure }: { figure: GlanceFigure }) {
  return (
    <Link
      href={figure.href}
      className="group @container flex min-h-11 min-w-0 flex-col gap-1.5 focus-visible:outline-panel-ink xl:border-l xl:border-panel-hairline xl:px-6 xl:first:border-l-0 xl:first:pl-0"
    >
      <span className="eyebrow break-words text-panel-muted transition-colors group-hover:text-panel-ink">{figure.label}</span>
      <span className={`num font-light text-panel-ink [overflow-wrap:anywhere] ${figureFit(figure.length)}`}>
        {figure.value}
      </span>
      <span className="text-small break-words text-panel-muted">
        {figure.sub}
        <span aria-hidden="true" className="ml-1.5 inline-block transition-transform group-hover:translate-x-0.5 group-hover:text-panel-ink">
          →
        </span>
      </span>
    </Link>
  );
}
