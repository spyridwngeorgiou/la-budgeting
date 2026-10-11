import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { PageHeader, SectionHeader } from "@/components/ui";
import { specTd as TD, specTh as TH } from "@/components/specTable";
import { aiEnabled } from "@/lib/ai/client";
import { rankAttention } from "@/lib/dashboard/attention";
import { DashboardSummary } from "./DashboardSummary";
import { AskAssistantCard } from "./AskAssistantCard";
import { addDays, monthKeyOf, monthLabel, todayAthens } from "@/lib/dates";
import { dashboardTiles, type DashboardTile } from "@/lib/dashboard/tiles";
import { loadInboxCounts } from "@/lib/data/inboxCount";
import { inboxTotal } from "@/lib/ingest/inboxCount";
import { loadPendingCaptures } from "@/lib/ingest/pendingCaptures";

// Αρχική: eight tiles (one per area, lib/dashboard/tiles.ts), the few things that need attention, the
// project portfolio, then the AI. Every figure reads from the SQL views
// (0011_views.sql and later), never from a hand-maintained rollup, so it can
// never drift from the ledger. The month calendar lives at /calendar.
//
// Every KPI figure links through to /transactions pre-filtered to the rows
// behind that number (or to the report that computes it) -- a total is a
// claim, the underlying rows are the evidence.
//
// View columns are all nullable (Postgres views carry no NOT NULL
// guarantees even when the underlying table does), so every read here goes
// through `?? 0` / `?? ""` rather than assuming a value is present.
export default async function DashboardPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

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
  ] = await Promise.all([
    supabase.from("v_project_rollup").select("*").eq("org_id", orgId).order("code"),
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
      .select("id, due_date, direction, status, gross_amount")
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
    // Calendar tile: items overlapping the next 7 days (today included),
    // same overlap rule as the calendar itself; head-only, no rows travel.
    supabase
      .from("v_calendar_items")
      .select("item_key", { count: "exact", head: true })
      .eq("org_id", orgId)
      .lte("starts_on", addDays(todayIso, 6))
      .gte("ends_on", todayIso)
      .not("is_done", "is", true),
    // Result tile: the year so far, same function and defaults as /reports/pnl.
    supabase.rpc("pnl_summary", { p_org: orgId, p_from: `${todayIso.slice(0, 4)}-01-01`, p_to: todayIso }),
    // The nav badge's number (cached per request: the layout reads it too).
    loadInboxCounts(orgId).then(inboxTotal),
  ]);

  const noBudget = new Set((withoutBudget ?? []).map((r) => r.project_id));

  const cashOf = (scope: "corporate" | "personal") =>
    (liquidity ?? []).filter((l) => l.owner_scope === scope).reduce((sum, l) => sum + Number(l.balance ?? 0), 0);
  const cashCorporate = cashOf("corporate");
  const cashPersonal = cashOf("personal");
  const lowest = (forecast ?? []).reduce<NonNullable<typeof forecast>[number] | null>(
    (min, m) => (!min || Number(m.closing_balance) < Number(min.closing_balance) ? m : min),
    null,
  );
  const forecastBelow = (forecast ?? []).find((m) => m.below_buffer);
  // "Πληρωτέο" only makes sense as of the latest period: the running balance
  // already carries every prior period forward.
  const currentVat = vat?.[0];

  const overdue = (openTx ?? []).filter((tx) => tx.due_date && tx.due_date < todayIso);
  const pendingSum = (direction: "income" | "expense") =>
    (openTx ?? [])
      .filter((tx) => tx.status === "pending" && tx.direction === direction)
      .reduce((s, tx) => s + Number(tx.gross_amount ?? 0), 0);
  const receivables = pendingSum("income");
  const payables = pendingSum("expense");

  // Projects with an actual budget (noBudget already excludes the ones with
  // none, same set the portfolio table below uses) whose capex has run past
  // it -- v_project_rollup.remaining_budget already accounts for capex-only
  // consumption (0020_cost_treatment.sql), so a negative value here is real.
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
  const [{ data: uninvoiced }, { data: accountIssues }, { data: contactless }] = await Promise.all([
    supabase.from("v_qc_uninvoiced_large_expenses").select("lost_deduction_est, lost_input_vat_est").eq("org_id", orgId),
    supabase.from("v_qc_account_drift").select("account_name, drift, issue, days_since_count").eq("org_id", orgId),
    supabase.from("v_qc_counterparty_without_contact").select("n").eq("org_id", orgId),
  ]);
  const uninvoicedLost = (uninvoiced ?? []).reduce(
    (sum, r) => sum + Number(r.lost_deduction_est ?? 0) + Number(r.lost_input_vat_est ?? 0),
    0,
  );
  const uncountedAccounts = (accountIssues ?? []).filter((a) => a.issue !== "drift").length;
  const contactlessRows = (contactless ?? []).reduce((s, r) => s + Number(r.n ?? 0), 0);
  const inboxCount = pendingCaptures.count + (pendingChanges ?? 0);

  // The dashboard's single worklist, ranked by severity and capped
  // (lib/dashboard/attention.ts), so a zero-item list is a real, trustworthy
  // "nothing needs you today".
  const tiles = dashboardTiles({
    cashCorporate,
    cashPersonal,
    lowest,
    inboxPending,
    calendarNext7: calendarNext7 ?? 0,
    year: Number(todayIso.slice(0, 4)),
    pnlRows: pnlRows ?? [],
    vatPayable: Number(currentVat?.payable_after_credit ?? 0),
    receivables,
    payables,
    activeProjects: (projects ?? []).filter((p) => p.status === "active").length,
    overBudgetProjects: overBudgetProjects.length,
  });

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
    // Captures waiting on review and AI proposals: one row, one place.
    inboxCount > 0 && { kind: "inbox", label: `Εισερχόμενα: ${inboxCount} προς έλεγχο`, href: "/inbox" },
    unfiledVatPeriods.length > 0 && {
      kind: "vatUnfiled",
      label: `${unfiledVatPeriods.length} περίοδ${unfiledVatPeriods.length === 1 ? "ος ΦΠΑ" : "οι ΦΠΑ"} χωρίς υποβολή`,
      href: "/reports/vat",
    },
    ...(accountIssues ?? [])
      .filter((a) => a.issue === "drift")
      .map((a) => ({
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

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={el.nav.dashboard}
        meta="Ένα πλακίδιο ανά ενότητα, εκκρεμότητες και έργα με μια ματιά. Κάθε νούμερο ανοίγει τη σελίδα από την οποία προκύπτει."
      />

      <section aria-label="Με μια ματιά" className="flex flex-col">
        <div className="grid grid-cols-2 border-t border-l border-hairline lg:grid-cols-4">
          {tiles.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Το ταμείο μετρά μόνο ρευστούς λογαριασμούς· χρυσός και crypto εμφανίζονται στην Καθαρή θέση.
        </p>
      </section>

      <section className="flex flex-col">
        <SectionHeader title="Χρειάζεται Προσοχή" />
        {attention.shown.length === 0 ? (
          <p className="border-b border-hairline py-3 text-sm text-muted">Τίποτα δεν χρειάζεται προσοχή αυτή τη στιγμή.</p>
        ) : (
          <ul className="flex flex-col">
            {attention.shown.map((item) => (
              <li key={item.href + item.label} className="border-b border-hairline">
                <Link
                  href={item.href}
                  className="flex min-h-11 items-center justify-between gap-3 border-l-2 border-negative py-2.5 pr-2 pl-4 text-sm text-ink transition-colors hover:bg-hover"
                >
                  <span>{item.label}</span>
                  <span aria-hidden="true" className="shrink-0 text-muted">
                    →
                  </span>
                </Link>
              </li>
            ))}
            {attention.more > 0 && (
              <li className="flex min-h-11 flex-wrap items-center gap-x-4 border-b border-hairline py-2.5 pr-2 pl-4 text-sm text-muted">
                <span>+{attention.more} ακόμα</span>
                <Link href="/inbox" className="text-ink underline-offset-4 hover:underline">
                  Εισερχόμενα →
                </Link>
                <Link href="/reports/quality" className="text-ink underline-offset-4 hover:underline">
                  Ποιότητα δεδομένων →
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Χαρτοφυλάκιο Έργων" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Έργο
                </th>
                <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>
                  {el.project.budget}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Δαπανηθέντα
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Εκκρεμούν
                </th>
                <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>
                  + ΦΠΑ
                </th>
              </tr>
            </thead>
            <tbody>
              {(projects ?? []).map((p) => (
                <tr key={p.project_id} className="hover:bg-hover">
                  <td className={`${TD} text-ink`}>
                    <Link href={`/projects/${p.project_id}`} className="underline-offset-4 hover:underline">
                      {p.display_name}
                    </Link>
                  </td>
                  <td className={`${TD} num hidden text-right sm:table-cell`}>
                    {noBudget.has(p.project_id) ? <span className="text-muted">—</span> : formatMoney(p.total_budget)}
                  </td>
                  <td className={`${TD} num text-right`}>
                    <Link
                      href={`/transactions?project_id=${p.project_id}&direction=expense&status=paid`}
                      className="underline-offset-4 hover:underline"
                    >
                      {formatMoney(p.spent)}
                    </Link>
                  </td>
                  <td className={`${TD} num text-right`}>
                    <Link
                      href={`/transactions?project_id=${p.project_id}&direction=expense&status=pending`}
                      className="underline-offset-4 hover:underline"
                    >
                      {formatMoney(p.pending)}
                    </Link>
                  </td>
                  <td className={`${TD} num hidden text-right sm:table-cell`}>
                    <Link
                      href={`/transactions?project_id=${p.project_id}&direction=expense`}
                      className="underline-offset-4 hover:underline"
                    >
                      {formatMoney(p.vat_on_expenses)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {aiEnabled() && (
        <section className="flex flex-col gap-4">
          <DashboardSummary />
          <AskAssistantCard />
        </section>
      )}
    </div>
  );
}

// One P15 tile: hairline grid cell, eyebrow, a big light tabular figure and
// a small sub-line; the whole tile is the link.
function Tile({ tile }: { tile: DashboardTile }) {
  return (
    <Link
      href={tile.href}
      className="flex min-w-0 flex-col gap-2 border-r border-b border-hairline p-4 transition-colors hover:bg-hover"
    >
      <span className="eyebrow truncate text-muted">{tile.eyebrow}</span>
      <span className={`num truncate text-figure-sm font-light ${tile.negative ? "text-negative" : "text-ink"}`}>{tile.value}</span>
      <span className="text-xs text-muted">{tile.sub}</span>
    </Link>
  );
}
