import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { aiEnabled } from "@/lib/ai/client";
import { DashboardSummary } from "./DashboardSummary";
import { DueDatesCalendar } from "./DueDatesCalendar";

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

  // v_vat_position only has a row for months with actual transactions, and
  // "most recent row" naively includes FUTURE scheduled months -- a
  // scheduled transaction dated next year would otherwise outrank every
  // real period and show as "current month" with misleading zeros. Pin to
  // the latest period that isn't in the future.
  const todayIso = new Date().toISOString().slice(0, 10);

  // Full calendar-month grid, not just "next 14 days" -- Monday of the first
  // week through Sunday of the last week of the current month, so overdue
  // days earlier this month and upcoming days later this month both show up
  // as positions on the calendar, not a sorted list.
  const now = new Date(todayIso + "T00:00:00Z");
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - ((firstOfMonth.getUTCDay() + 6) % 7));
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (7 - ((lastOfMonth.getUTCDay() + 6) % 7) - 1));

  const [
    { data: accounts },
    { data: projects },
    { data: vat },
    { data: withoutBudget },
    { data: dueDates },
    { data: vatPeriods },
    { count: missingProjectOrAccount },
    { data: pendingDraftRows, count: pendingDrafts },
    { count: pendingChanges },
  ] = await Promise.all([
    supabase.from("v_account_balances").select("*").order("owner_scope"),
    supabase.from("v_project_rollup").select("*").order("code"),
    supabase
      .from("v_vat_position")
      .select("*")
      .lte("period_start", todayIso)
      .order("period_start", { ascending: false }),
    supabase.from("v_qc_projects_without_budget").select("project_id"),
    // The comment above has promised "what's due soon" since this page's
    // first version -- the data (transactions.due_date on pending/scheduled
    // rows, already populated by loan/installment schedules) was always
    // there, just never surfaced. Real business impact: an upcoming loan or
    // installment payment could be missed with zero warning anywhere in the app.
    supabase
      .from("transactions")
      .select("id, due_date, direction, gross_amount")
      .in("status", ["pending", "scheduled"])
      .not("due_date", "is", null)
      .gte("due_date", gridStart.toISOString().slice(0, 10))
      .lte("due_date", gridEnd.toISOString().slice(0, 10)),
    // Filing status per period, same source /vat uses -- lets the worklist
    // flag a past period nobody has marked as filed yet.
    supabase.from("vat_periods").select("period_start, status"),
    supabase.from("v_qc_missing_project_or_account").select("transaction_id", { count: "exact", head: true }),
    supabase.from("transaction_drafts").select("id", { count: "exact" }).eq("status", "pending").order("created_at"),
    supabase.from("agent_changes").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const noBudget = new Set((withoutBudget ?? []).map((r) => r.project_id));

  const liquidTotal = (accounts ?? []).reduce(
    (sum, a) => sum + Number(a.current_balance ?? 0),
    0,
  );
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
  // /vat uses for its badge.
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
    .select("lost_deduction_est, lost_input_vat_est");
  const uninvoicedLost = (uninvoiced ?? []).reduce(
    (sum, r) => sum + Number(r.lost_deduction_est ?? 0) + Number(r.lost_input_vat_est ?? 0),
    0,
  );

  const worklist = [
    overdue.length > 0 && {
      label: `${overdue.length} ληξιπρόθεσμ${overdue.length === 1 ? "η υποχρέωση" : "ες υποχρεώσεις"}`,
      href: `/transactions?ids=${overdue.map((tx) => tx.id).join(",")}`,
    },
    (pendingDrafts ?? 0) > 0 && {
      label: `${pendingDrafts} πρόχειρ${pendingDrafts === 1 ? "η κίνηση" : "ες κινήσεις"} προς έλεγχο`,
      // Straight into the review screen for the oldest pending draft, the
      // rest queued behind it (same ?queue= mechanism approveDraft/
      // discardDraft already use to chain through several) -- not
      // /documents/new, which is for capturing a NEW entry and has nothing
      // to do with drafts already waiting on a decision.
      href: (() => {
        const [first, ...rest] = (pendingDraftRows ?? []).map((d) => d.id);
        return first ? `/documents/${first}/review${rest.length > 0 ? `?queue=${rest.join(",")}` : ""}` : "/documents/new";
      })(),
    },
    (pendingChanges ?? 0) > 0 && {
      label: `${pendingChanges} εκκρεμ${pendingChanges === 1 ? "ής πρόταση AI" : "είς προτάσεις AI"}`,
      href: "/changes",
    },
    (missingProjectOrAccount ?? 0) > 0 && {
      label: `${missingProjectOrAccount} ${missingProjectOrAccount === 1 ? "κίνηση" : "κινήσεις"} χωρίς έργο/λογαριασμό`,
      href: "/quality",
    },
    overBudgetProjects.length > 0 && {
      label: `${overBudgetProjects.length} έργ${overBudgetProjects.length === 1 ? "ο εκτός" : "α εκτός"} προϋπολογισμού`,
      href: `/projects/${overBudgetProjects[0].project_id}`,
    },
    (uninvoiced ?? []).length > 0 && {
      label: `${(uninvoiced ?? []).length} δαπάνες χωρίς παραστατικό — ~${formatMoney(uninvoicedLost)} φόρος & ΦΠΑ που χάνονται`,
      href: "/quality",
    },
    unfiledVatPeriods.length > 0 && {
      label: `${unfiledVatPeriods.length} περίοδ${unfiledVatPeriods.length === 1 ? "ος ΦΠΑ" : "οι ΦΠΑ"} χωρίς υποβολή`,
      href: "/vat",
    },
  ].filter((x): x is { label: string; href: string } => Boolean(x));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{el.nav.dashboard}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ρευστότητα, έργα και ΦΠΑ με μια ματιά. Κάθε ποσό είναι κλικάρισμα στις κινήσεις που το
          απαρτίζουν.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">Χρειάζεται Προσοχή</h2>
        {worklist.length === 0 ? (
          <div className="rounded-md border border-sage-strong/50 bg-sage/30 px-3 py-2 text-sm text-sage-ink">
            Τίποτα δεν χρειάζεται προσοχή αυτή τη στιγμή.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {worklist.map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className="flex items-center justify-between gap-2 rounded-md border border-red-ink/40 bg-red-bg px-3 py-2 text-sm text-red-ink transition-colors hover:bg-red-bg/70"
              >
                <span>{item.label}</span>
                <span>→</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {aiEnabled() && <DashboardSummary />}

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">Ρευστότητα</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(accounts ?? []).map((a) => (
            <Link
              key={a.account_id}
              href={`/transactions?account_id=${a.account_id}`}
              className="rounded border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface"
            >
              <div className="text-xs text-ink-muted">{a.name}</div>
              <div className="font-mono text-lg">{formatMoney(a.current_balance)}</div>
            </Link>
          ))}
          <div className="rounded border border-ink bg-ink p-3 text-white">
            <div className="text-xs text-white/70">Σύνολο Ρευστών</div>
            <div className="font-mono text-lg">{formatMoney(liquidTotal)}</div>
          </div>
        </div>
      </section>

      {dueDates && dueDates.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-ink-muted">Προσεχείς Υποχρεώσεις</h2>
          <DueDatesCalendar dueDates={dueDates} todayIso={todayIso} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">Χαρτοφυλάκιο Έργων</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1 pr-4">Έργο</th>
                <th className="hidden py-1 pr-4 sm:table-cell">{el.project.budget}</th>
                <th className="py-1 pr-4">Δαπανηθέντα</th>
                <th className="py-1 pr-4">Εκκρεμούν</th>
                <th className="hidden py-1 pr-4 sm:table-cell">+ ΦΠΑ</th>
              </tr>
            </thead>
            <tbody>
              {(projects ?? []).map((p) => (
                <tr key={p.project_id} className="border-t border-line">
                  <td className="py-1.5 pr-4">
                    <Link href={`/projects/${p.project_id}`} className="hover:underline">
                      {p.display_name}
                    </Link>
                  </td>
                  <td className="hidden py-1.5 pr-4 font-mono sm:table-cell">
                    {noBudget.has(p.project_id) ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      formatMoney(p.total_budget)
                    )}
                  </td>
                  <td className="py-1.5 pr-4 font-mono">
                    <Link
                      href={`/transactions?project_id=${p.project_id}&direction=expense&status=paid`}
                      className="hover:underline"
                    >
                      {formatMoney(p.spent)}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-4 font-mono">
                    <Link
                      href={`/transactions?project_id=${p.project_id}&direction=expense&status=pending`}
                      className="hover:underline"
                    >
                      {formatMoney(p.pending)}
                    </Link>
                  </td>
                  <td className="hidden py-1.5 pr-4 font-mono sm:table-cell">
                    <Link
                      href={`/transactions?project_id=${p.project_id}&direction=expense`}
                      className="hover:underline"
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

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">
          Θέση ΦΠΑ <span className="font-normal text-ink-faint">— σύνολο όλων των περιόδων</span>
        </h2>
        {currentVat ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="ΦΠΑ Εκροών (σύνολο)"
              value={formatMoney(vatIncomeTotal)}
              href={`/transactions?direction=income&from=${earliestPeriod}`}
            />
            <Stat
              label="ΦΠΑ Εισροών (σύνολο)"
              value={formatMoney(vatExpenseTotal)}
              href={`/transactions?direction=expense&from=${earliestPeriod}`}
            />
            <Stat label="Τρέχον Πιστωτικό" value={formatMoney(Math.abs(currentVat.credit_balance ?? 0))} />
            <Stat label="Συνολικά Οφειλόμενο Τώρα" value={formatMoney(currentVat.payable_after_credit)} />
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Δεν υπάρχουν ακόμα κινήσεις.</p>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          Οι δύο πρώτες τιμές είναι το άθροισμα όλων των μηνών· το πιστωτικό/οφειλόμενο είναι η
          τρέχουσα θέση (ήδη συνυπολογίζει τη μεταφορά πιστωτικού από κάθε προηγούμενο μήνα). Για
          ανάλυση ανά μήνα δείτε τη σελίδα ΦΠΑ.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block rounded border border-line p-3 transition-colors hover:border-line-strong hover:bg-surface"
      >
        {content}
      </Link>
    );
  }
  return <div className="rounded border border-line p-3">{content}</div>;
}
