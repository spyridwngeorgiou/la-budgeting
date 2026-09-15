import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { aiEnabled } from "@/lib/ai/client";
import { DashboardSummary } from "./DashboardSummary";

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

  const [{ data: accounts }, { data: projects }, { data: vat }, { data: withoutBudget }] = await Promise.all([
    supabase.from("v_account_balances").select("*").order("owner_scope"),
    supabase.from("v_project_rollup").select("*").order("code"),
    supabase
      .from("v_vat_position")
      .select("*")
      .lte("period_start", todayIso)
      .order("period_start", { ascending: false }),
    supabase.from("v_qc_projects_without_budget").select("project_id"),
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{el.nav.dashboard}</h1>

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

      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">Χαρτοφυλάκιο Έργων</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-1 pr-4">Έργο</th>
                <th className="py-1 pr-4">Budget</th>
                <th className="py-1 pr-4">Δαπανηθέντα</th>
                <th className="py-1 pr-4">Εκκρεμούν</th>
                <th className="py-1 pr-4">+ ΦΠΑ</th>
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
                  <td className="py-1.5 pr-4 font-mono">
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
                  <td className="py-1.5 pr-4 font-mono">
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
