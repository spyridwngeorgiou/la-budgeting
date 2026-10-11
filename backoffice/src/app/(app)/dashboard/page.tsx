import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { PageHeader, SectionHeader } from "@/components/ui";
import { specTd as TD, specTh as TH } from "@/components/specTable";
import { aiEnabled } from "@/lib/ai/client";
import { DashboardSummary } from "./DashboardSummary";
import { AskAssistantCard } from "./AskAssistantCard";
import { DueDatesCalendar } from "./DueDatesCalendar";
import { monthGridRange } from "@/lib/planner/calendar";
import { monthKeyOf, monthLabel, todayAthens } from "@/lib/dates";
import { loadPendingCaptures } from "@/lib/ingest/pendingCaptures";

// Κέντρο Ελέγχου: liquidity per account, project portfolio, VAT position,
// what's due soon -- the same shape as the workbook's Control Center sheet.
// Every figure here reads from the views in 0011_views.sql, never from a
// hand-maintained rollup, so it can never drift from the ledger.
//
// Every KPI figure links through to /transactions pre-filtered to exactly
// the rows behind that number -- a total is a claim, the underlying rows
// are the evidence.
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

  // Full calendar-month grid, not just "next 14 days" -- Monday of the first
  // week through Sunday of the last week of the current month, so overdue
  // days earlier this month and upcoming days later this month both show up
  // as positions on the calendar, not a sorted list.
  const grid = monthGridRange(monthKeyOf(todayIso));

  const [
    { data: accounts },
    { data: projects },
    { data: vat },
    { data: withoutBudget },
    { data: dueDates },
    { data: vatPeriods },
    { count: missingProjectOrAccount },
    pendingCaptures,
    { count: pendingChanges },
    { data: liquidity },
    { data: forecast },
  ] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("org_id", orgId).order("owner_scope"),
    supabase.from("v_project_rollup").select("*").eq("org_id", orgId).order("code"),
    supabase
      .from("v_vat_position")
      .select("*")
      .eq("org_id", orgId)
      .lte("period_start", todayIso)
      .order("period_start", { ascending: false }),
    supabase.from("v_qc_projects_without_budget").select("project_id").eq("org_id", orgId),
    // The comment above has promised "what's due soon" since this page's
    // first version -- the data (transactions.due_date on pending/scheduled
    // rows, already populated by loan/installment schedules) was always
    // there, just never surfaced. Real business impact: an upcoming loan or
    // installment payment could be missed with zero warning anywhere in the app.
    supabase
      .from("transactions")
      .select("id, due_date, direction, gross_amount")
      .eq("org_id", orgId)
      .in("status", ["pending", "scheduled"])
      .not("due_date", "is", null)
      // No lower bound: a bill overdue since an earlier month must still
      // count in «ληξιπρόθεσμες» below (the calendar just leaves out days
      // outside this month).
      .lte("due_date", grid.end),
    // Filing status per period, same source /reports/vat uses -- lets the worklist
    // flag a past period nobody has marked as filed yet.
    supabase.from("vat_periods").select("period_start, status").eq("org_id", orgId),
    supabase.from("v_qc_missing_project_or_account").select("transaction_id", { count: "exact", head: true }).eq("org_id", orgId),
    loadPendingCaptures(supabase, orgId),
    supabase.from("agent_changes").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["pending", "conflict"]),
    // Liquid cash (v_liquidity, 0066) and the six-month runway from the same
    // cash_forecast() /reports/cash shows -- never re-derived here.
    supabase.from("v_liquidity").select("owner_scope, balance").eq("org_id", orgId),
    supabase.rpc("cash_forecast", { p_org: orgId, p_months: 6 }),
  ]);

  const noBudget = new Set((withoutBudget ?? []).map((r) => r.project_id));

  const liquidTotal = (liquidity ?? []).reduce((sum, l) => sum + Number(l.balance ?? 0), 0);
  const forecastEnd = forecast?.[forecast.length - 1];
  const forecastBelow = (forecast ?? []).find((m) => m.below_buffer);
  // "Πληρωτέο"/"Πιστωτικό" only make sense as of the latest period (the
  // running balance already carries every prior period forward -- that IS
  // the current owed/credit total, summing it across periods would double
  // count). ΦΠΑ Εκροών/Εισροών are different: those are real per-period
  // flows, so a lifetime total there is an honest sum, not a distortion.
  const currentVat = vat?.[0];
  const vatIncomeTotal = (vat ?? []).reduce((s, v) => s + Number(v.vat_income ?? 0), 0);
  const vatExpenseTotal = (vat ?? []).reduce((s, v) => s + Number(v.vat_expense ?? 0), 0);
  const earliestPeriod = vat && vat.length > 0 ? vat[vat.length - 1].period_start : null;

  // Same data the due-dates calendar below already uses -- the overdue
  // subset just gets its own direct link up top, since "how many need
  // attention right now" shouldn't require reading the whole calendar grid.
  const overdue = (dueDates ?? []).filter((tx) => tx.due_date! < todayIso);

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

  // The dashboard's single worklist -- previously "needs attention" meant
  // only the overdue-payments banner; this folds in every other pending
  // signal already computed elsewhere in the app (quality checks, draft
  // review, AI change approval, VAT filing) so a zero-item list is a real,
  // trustworthy "nothing needs you today", not just "nothing overdue".
  // Tax risk: paid business expenses above the threshold with no invoice (or
  // paid in cash) -- v_qc_uninvoiced_large_expenses (0029). Shown as money
  // lost, not a row count: that's the number that makes someone chase the invoice.
  const { data: uninvoiced } = await supabase
    .from("v_qc_uninvoiced_large_expenses")
    .select("lost_deduction_est, lost_input_vat_est")
    .eq("org_id", orgId);
  const uninvoicedLost = (uninvoiced ?? []).reduce(
    (sum, r) => sum + Number(r.lost_deduction_est ?? 0) + Number(r.lost_input_vat_est ?? 0),
    0,
  );

  // Where the ledger and reality disagree (or the app is blind): warned about,
  // never silently "fixed" by editing opening balances -- v_qc_account_drift /
  // v_qc_counterparty_without_contact (0033).
  const [{ data: accountIssues }, { data: contactless }] = await Promise.all([
    supabase.from("v_qc_account_drift").select("account_name, drift, issue, days_since_count").eq("org_id", orgId),
    supabase.from("v_qc_counterparty_without_contact").select("n").eq("org_id", orgId),
  ]);
  const driftItems = (accountIssues ?? [])
    .filter((a) => a.issue === "drift")
    .map((a) => ({
      label: `${a.account_name}: λείπουν ${Number(a.drift) < 0 ? "έξοδα" : "έσοδα"} ${formatMoney(Math.abs(Number(a.drift)))} (έλεγχος με πραγματικό υπόλοιπο)`,
      href: "/accounts",
    }));
  const uncountedAccounts = (accountIssues ?? []).filter((a) => a.issue !== "drift").length;
  const contactlessRows = (contactless ?? []).reduce((s, r) => s + Number(r.n ?? 0), 0);

  const worklist = [
    ...driftItems,
    uncountedAccounts > 0 && {
      label: `${uncountedAccounts} ${uncountedAccounts === 1 ? "λογαριασμός" : "λογαριασμοί"} χωρίς μέτρηση υπολοίπου τον τελευταίο μήνα`,
      href: "/accounts",
    },
    contactlessRows > 0 && {
      label: `${contactlessRows} ${contactlessRows === 1 ? "κίνηση" : "κινήσεις"} με αντισυμβαλλόμενο χωρίς επαφή`,
      href: "/reports/quality",
    },
    overdue.length > 0 && {
      label: `${overdue.length} ληξιπρόθεσμ${overdue.length === 1 ? "η υποχρέωση" : "ες υποχρεώσεις"}`,
      href: `/transactions?ids=${overdue.map((tx) => tx.id).join(",")}`,
    },
    pendingCaptures.count > 0 && {
      label: `${pendingCaptures.count} πρόχειρ${pendingCaptures.count === 1 ? "η κίνηση" : "ες κινήσεις"} προς έλεγχο`,
      // Straight into the review of the oldest capture waiting on a
      // decision (lib/ingest/pendingCaptures.ts: old draft review or the
      // inbox, depending on INGEST_UNIFIED).
      href: pendingCaptures.href,
    },
    (pendingChanges ?? 0) > 0 && {
      label: `${pendingChanges} εκκρεμ${pendingChanges === 1 ? "ής πρόταση AI" : "είς προτάσεις AI"}`,
      href: "/assistant?panel=changes",
    },
    (missingProjectOrAccount ?? 0) > 0 && {
      label: `${missingProjectOrAccount} ${missingProjectOrAccount === 1 ? "κίνηση" : "κινήσεις"} χωρίς έργο/λογαριασμό`,
      href: "/reports/quality",
    },
    overBudgetProjects.length > 0 && {
      label: `${overBudgetProjects.length} έργ${overBudgetProjects.length === 1 ? "ο εκτός" : "α εκτός"} προϋπολογισμού`,
      href: `/projects/${overBudgetProjects[0].project_id}`,
    },
    (uninvoiced ?? []).length > 0 && {
      label: `${(uninvoiced ?? []).length} δαπάνες χωρίς παραστατικό — ~${formatMoney(uninvoicedLost)} φόρος & ΦΠΑ που χάνονται`,
      href: "/reports/quality",
    },
    forecastBelow && {
      label: `Η πρόβλεψη ταμείου πέφτει κάτω από το απόθεμα ασφαλείας ${monthLabel(monthKeyOf(forecastBelow.month))}`,
      href: "/reports/cash",
    },
    unfiledVatPeriods.length > 0 && {
      label: `${unfiledVatPeriods.length} περίοδ${unfiledVatPeriods.length === 1 ? "ος ΦΠΑ" : "οι ΦΠΑ"} χωρίς υποβολή`,
      href: "/reports/vat",
    },
  ].filter((x): x is { label: string; href: string } => Boolean(x));

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={el.nav.dashboard}
        meta="Ρευστότητα, έργα και ΦΠΑ με μια ματιά. Κάθε ποσό είναι κλικάρισμα στις κινήσεις που το απαρτίζουν."
      />

      <section className="flex flex-col">
        <SectionHeader title="Χρειάζεται Προσοχή" />
        {worklist.length === 0 ? (
          <p className="border-b border-hairline py-3 text-sm text-muted">Τίποτα δεν χρειάζεται προσοχή αυτή τη στιγμή.</p>
        ) : (
          <ul className="flex flex-col">
            {worklist.map((item) => (
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
          </ul>
        )}
      </section>

      {aiEnabled() && <DashboardSummary />}
      {aiEnabled() && <AskAssistantCard />}

      <section className="flex flex-col">
        <SectionHeader title="Ρευστότητα" />
        <div className="grid grid-cols-2 sm:grid-cols-3">
          {(accounts ?? []).map((a) => (
            <Link
              key={a.account_id}
              href={`/transactions?account_id=${a.account_id}`}
              className="flex min-w-0 flex-col gap-1 border-b border-hairline py-4 pr-4 pl-1 transition-colors hover:bg-hover"
            >
              <span className="truncate text-small text-muted">{a.name}</span>
              <span className="num text-figure-sm font-light text-ink">{formatMoney(a.current_balance)}</span>
            </Link>
          ))}
          <div className="flex min-w-0 flex-col gap-1 border-b border-ink py-4 pr-4 pl-1">
            <span className="eyebrow text-ink">Σύνολο Ρευστών</span>
            <span className="num text-figure-sm font-light text-ink">{formatMoney(liquidTotal)}</span>
          </div>
          {forecastEnd && (
            <Link
              href="/reports/cash?months=6"
              className={`flex min-w-0 flex-col gap-1 border-b border-hairline py-4 pr-4 transition-colors hover:bg-hover ${
                forecastEnd.below_buffer ? "border-l-2 border-l-negative pl-3" : "pl-1"
              }`}
            >
              <span className="text-small text-muted">Πρόβλεψη σε 6 μήνες ({monthLabel(monthKeyOf(forecastEnd.month))})</span>
              <span className={`num text-figure-sm font-light ${forecastEnd.below_buffer ? "text-negative" : "text-ink"}`}>
                {formatMoney(forecastEnd.closing_balance)}
              </span>
            </Link>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Το σύνολο μετρά μόνο ρευστούς λογαριασμούς· χρυσός και crypto εμφανίζονται στην Καθαρή θέση.
        </p>
      </section>

      {dueDates && dueDates.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Προσεχείς Υποχρεώσεις" />
          <DueDatesCalendar dueDates={dueDates} todayIso={todayIso} />
        </section>
      )}

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

      <section className="flex flex-col">
        <SectionHeader
          title={
            <>
              Θέση ΦΠΑ <span className="text-small text-muted">— σύνολο όλων των περιόδων</span>
            </>
          }
        />
        {currentVat ? (
          <div className="grid grid-cols-2 sm:grid-cols-4">
            <VatStat
              label="ΦΠΑ Εκροών (σύνολο)"
              value={formatMoney(vatIncomeTotal)}
              href={`/transactions?direction=income&from=${earliestPeriod}`}
            />
            <VatStat
              label="ΦΠΑ Εισροών (σύνολο)"
              value={formatMoney(vatExpenseTotal)}
              href={`/transactions?direction=expense&from=${earliestPeriod}`}
            />
            <VatStat label="Τρέχον Πιστωτικό" value={formatMoney(Math.abs(currentVat.credit_balance ?? 0))} />
            <VatStat label="Συνολικά Οφειλόμενο Τώρα" value={formatMoney(currentVat.payable_after_credit)} />
          </div>
        ) : (
          <p className="py-3 text-sm text-muted">Δεν υπάρχουν ακόμα κινήσεις.</p>
        )}
        <p className="mt-2 text-xs text-muted">
          Οι δύο πρώτες τιμές είναι το άθροισμα όλων των μηνών· το πιστωτικό/οφειλόμενο είναι η
          τρέχουσα θέση (ήδη συνυπολογίζει τη μεταφορά πιστωτικού από κάθε προηγούμενο μήνα). Για
          ανάλυση ανά μήνα δείτε τη σελίδα ΦΠΑ.
        </p>
      </section>
    </div>
  );
}

function VatStat({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <>
      <span className="eyebrow text-muted">{label}</span>
      <span className="num text-figure-sm font-light text-ink">{value}</span>
    </>
  );
  const cls = "flex min-w-0 flex-col gap-1.5 border-b border-hairline py-4 pr-4 pl-1";
  if (href) {
    return (
      <Link href={href} className={`${cls} transition-colors hover:bg-hover`}>
        {content}
      </Link>
    );
  }
  return <div className={cls}>{content}</div>;
}
