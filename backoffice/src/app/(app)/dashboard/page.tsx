import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { AiSpark, figureFit, GlancePanel, PageHeader, SectionHeader } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/client";
import { rankAttention } from "@/lib/dashboard/attention";
import { DashboardSummary } from "./DashboardSummary";
import { AskAssistantCard } from "./AskAssistantCard";
import { addDays, longDateLabel, monthKeyOf, monthLabel, todayAthens } from "@/lib/dates";
import { overviewCards, overviewGlance, type DestinationCard, type GlanceFigure } from "@/lib/dashboard/overview";
import { loadInboxCounts } from "@/lib/data/inboxCount";
import { inboxTotal } from "@/lib/ingest/inboxCount";
import { loadPendingCaptures } from "@/lib/ingest/pendingCaptures";

// Επισκόπηση: the page you navigate FROM. Four figures «Με μια ματιά», one
// card per menu section (lib/dashboard/overview.ts) with one live line
// each, the few things that need attention, then the AI. Every figure reads
// from the SQL views (0011_views.sql and later), never from a hand-maintained
// rollup, so it can never drift from the ledger. Server-rendered only: no
// client JS beyond the opt-in AI summary.
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

  const [
    { data: projects },
    { data: vat },
    { data: withoutBudget },
    { data: openTx },
    { data: vatPeriods },
    { count: missingProjectOrAccount },
    pendingCaptures,
    { count: pendingChanges },
    { data: liquidity },
    { data: forecast },
    { count: calendarNext7 },
    { data: pnlRows },
    inboxPending,
    { count: accountsCount },
    { count: openTasks },
    { count: contactsCount },
  ] = await Promise.all([
    supabase.from("v_project_rollup").select("project_id, status, remaining_budget").eq("org_id", orgId).order("code"),
    supabase
      .from("v_vat_position")
      .select("period_start, payable_after_credit")
      .eq("org_id", orgId)
      .lte("period_start", todayIso)
      .order("period_start", { ascending: false }),
    supabase.from("v_qc_projects_without_budget").select("project_id").eq("org_id", orgId),
    // Open rows: every pending one (receivables/payables, as in
    // v_net_worth_items) plus scheduled ones already past their due date
    // («ληξιπρόθεσμες»). An upcoming loan or installment payment must never
    // be missed with zero warning anywhere in the app.
    supabase
      .from("transactions")
      .select("id, due_date, status")
      .eq("org_id", orgId)
      .in("status", ["pending", "scheduled"])
      .or(`status.eq.pending,due_date.lt.${todayIso}`),
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
    // Calendar card: items overlapping the next 7 days (today included),
    // same overlap rule as the calendar itself; head-only, no rows travel.
    supabase
      .from("v_calendar_items")
      .select("item_key", { count: "exact", head: true })
      .eq("org_id", orgId)
      .lte("starts_on", addDays(todayIso, 6))
      .gte("ends_on", todayIso)
      .not("is_done", "is", true),
    // Result figure: the year so far, same function and defaults as /reports/pnl.
    supabase.rpc("pnl_summary", { p_org: orgId, p_from: `${todayIso.slice(0, 4)}-01-01`, p_to: todayIso }),
    // The nav badge's number (cached per request: the layout reads it too).
    canReview ? loadInboxCounts(orgId).then(inboxTotal) : 0,
    // Head-only counts for the destination cards: no rows travel.
    supabase.from("accounts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_active", true),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("archived_at", null)
      .neq("status", "done"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);

  const noBudget = new Set((withoutBudget ?? []).map((r) => r.project_id));

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
  const pendingCount = (openTx ?? []).filter((tx) => tx.status === "pending").length;

  // Projects with an actual budget (noBudget excludes the ones with none)
  // whose capex has run past it -- v_project_rollup.remaining_budget already
  // accounts for capex-only consumption (0020_cost_treatment.sql), so a
  // negative value here is real.
  const overBudgetProjects = (projects ?? []).filter(
    (p) => !noBudget.has(p.project_id) && Number(p.remaining_budget ?? 0) < 0,
  );

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

  const inputs = {
    cashCorporate: cashOf("corporate"),
    cashPersonal: cashOf("personal"),
    lowest,
    lowestDriver: lowestItems?.[0] ?? null,
    year: Number(todayIso.slice(0, 4)),
    pnlRows: pnlRows ?? [],
    vatPayable: Number(currentVat?.payable_after_credit ?? 0),
    canReview,
    inboxPending,
    overdue: overdue.length,
    pending: pendingCount,
    accounts: accountsCount ?? 0,
    accountDrift: driftAccounts.length,
    activeProjects: (projects ?? []).filter((p) => p.status === "active").length,
    overBudgetProjects: overBudgetProjects.length,
    openTasks: openTasks ?? 0,
    calendarNext7: calendarNext7 ?? 0,
    contacts: contactsCount ?? 0,
  };
  const glance = overviewGlance(inputs);
  const cards = overviewCards(inputs);

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
      href: "/reports/cash",
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
      href: `/projects/${overBudgetProjects[0].project_id}`,
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

  // An odd last card spans the empty cells, so the hairline grid closes.
  const lastSpan = [
    cards.length % 2 === 1 ? "max-lg:col-span-2" : "",
    cards.length % 3 === 1 ? "lg:col-span-3" : cards.length % 3 === 2 ? "lg:col-span-2" : "",
  ].join(" ");

  return (
    <div className="flex flex-col gap-10">
      <PageHeader eyebrow={longDateLabel(todayIso)} title={el.nav.dashboard} />

      <GlancePanel
        title="Με μια ματιά"
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

      <section aria-labelledby="destinations" className="flex flex-col gap-4">
        <SectionHeader title={<span id="destinations">Πού θέλετε να πάτε</span>} />
        <ul className="grid grid-cols-2 border-t border-l border-hairline lg:grid-cols-3">
          {cards.map((card, i) => (
            <li key={card.key} className={`min-w-0 border-r border-b border-hairline ${i === cards.length - 1 ? lastSpan : ""}`}>
              <Card card={card} />
            </li>
          ))}
        </ul>
      </section>

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
                {canReview && (
                  <Link href="/inbox" className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:underline">
                    Εισερχόμενα →
                  </Link>
                )}
                <Link href="/reports/quality" className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:underline">
                  Ποιότητα δεδομένων →
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>

      {aiEnabled() && (
        <section aria-label={el.nav.assistant} className="flex flex-col gap-4">
          <AskAssistantCard />
          <DashboardSummary />
        </section>
      )}
    </div>
  );
}

// One «Με μια ματιά» figure: eyebrow (wraps), big light tabular value, a
// muted line; the whole figure is the link to where the number comes from.
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

const SEVERITY_BAR: Record<NonNullable<DestinationCard["severity"]>, string> = {
  urgent: "border-negative",
  attention: "border-warning",
};
const SEVERITY_TEXT: Record<NonNullable<DestinationCard["severity"]>, string> = {
  urgent: "text-negative",
  attention: "text-warning",
};

// One destination: section name, what you do there, one live line. The
// whole cell is the link; hover draws the navy rule on top and tints it, an
// exception draws a 2px severity bar on the left.
function Card({ card }: { card: DestinationCard }) {
  const ai = card.key === "assistant";
  return (
    <Link
      href={card.href}
      className="group relative flex h-full min-h-36 min-w-0 flex-col gap-1.5 p-4 transition-colors hover:bg-hover sm:p-5"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 -top-px border-t-2 border-navy opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
      {card.severity && (
        <span aria-hidden="true" className={`absolute inset-y-0 -left-px border-l-2 ${SEVERITY_BAR[card.severity]}`} />
      )}
      <span className="flex items-baseline justify-between gap-2">
        <span className={`inline-flex min-w-0 items-center gap-1.5 text-section break-words ${ai ? "text-ai" : "text-ink"}`}>
          {ai && <AiSpark className="shrink-0" />}
          {card.title}
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink">
          →
        </span>
      </span>
      <span className="text-small text-muted">{card.description}</span>
      <span className={`num mt-auto pt-3 text-body ${card.severity ? SEVERITY_TEXT[card.severity] : "text-ink"}`}>{card.metric}</span>
    </Link>
  );
}
