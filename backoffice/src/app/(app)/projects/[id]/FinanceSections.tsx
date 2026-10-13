import Link from "next/link";
import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { Notice, ReportHistory, SpecTable, Td, Term, Th, Tr } from "@/components/ui";
import { formatDate, formatMoney, formatPercent, moneyOrDash } from "@/lib/format";
import { fillText } from "@/lib/collab/text";
import { el } from "@/lib/i18n/el";
import type { Tables } from "@/lib/db/types";
import type { DevelopmentResult } from "@/lib/finance/development";
import { ArgsDeleteButton, UtilityFormModal } from "../LegacyFormModals";
// Straight from the strings: a constant re-exported by a "use client" module
// reaches a server component as a client reference, not the object (the
// kind labels rendered empty).
import { projects as projectStrings } from "@/lib/i18n/v2/projects";
import { deleteUtility, saveUtility, syncLeaseScheduleAction } from "./finance-actions";

// Blocks of the project one-pager that read the ledger and the finance
// layer (v_project_rollup, 0069, development.ts, the property's costs).
// Server components; the figures come in computed, these only lay them out:
// three or four figures in view, the rest behind «▸ … (N)» (ReportHistory).

const LINE_ORDER = ["acquisition", "studies_permits_legal", "construction_equipment", "other", "contingency"] as const;

export interface BudgetLineRow {
  line_code: string | null;
  label: string | null;
  budget: number | null;
  paid: number | null;
  committed: number | null;
  remaining: number | null;
}

// The budget figures, as the v_project_rollup columns the projects list
// and the overview read too: total_budget, capex_paid, capex_committed,
// remaining_budget (= budget − paid − committed), unclassified_spend, and
// the operating costs kept outside the budget (occupancy_cost, other_opex).
export interface BudgetFigures {
  // null: no budget on file (not the same as a budget of zero).
  budget: number | null;
  paid: number;
  committed: number;
  remaining: number;
  unclassified: number;
  occupancy: number;
  otherOpex: number;
}

function budgetLinesInOrder(rows: BudgetLineRow[]): BudgetLineRow[] {
  return rows
    .filter((r) => Number(r.budget ?? 0) !== 0 || Number(r.paid ?? 0) + Number(r.committed ?? 0) !== 0)
    .sort(
      (a, b) =>
        LINE_ORDER.indexOf(a.line_code as (typeof LINE_ORDER)[number]) -
        LINE_ORDER.indexOf(b.line_code as (typeof LINE_ORDER)[number]),
    );
}

// ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ (ΕΠΕΝΔΥΣΗ and ΠΟΡΕΙΑ in one): the budget against what the
// capex has consumed -- only capex does (0020). Line by line, and the
// operating costs outside the budget, behind «▸ Ανά γραμμή (N)».
export function BudgetSection({
  projectId: id,
  figures: f,
  lines,
}: {
  projectId: string;
  figures: BudgetFigures;
  lines: BudgetLineRow[];
}) {
  const t = el.projectPage.budget;
  const byLine = f.budget != null ? budgetLinesInOrder(lines) : [];
  const outside = f.occupancy > 0 || f.otherOpex > 0;
  return (
    <OnePagerSection title={t.title} subtitle={t.subtitle}>
      <OnePagerRow label={t.budget} amount={f.budget ?? "—"} note={f.budget == null ? t.none : null} />
      <OnePagerRow label={t.paid} amount={f.paid} href={`/transactions?project_id=${id}&direction=expense&status=paid`} />
      <OnePagerRow
        label={<Term title={t.committedHint}>{t.committed}</Term>}
        amount={f.committed}
        href={`/transactions?project_id=${id}&direction=expense&status=pending`}
      />
      {f.budget != null && (
        <OnePagerRow label={t.remaining} amount={f.remaining} negative={f.remaining < 0} alert={f.remaining < 0} emphasis />
      )}
      {f.unclassified > 0 && (
        <OnePagerRow
          label={<Term title={t.unclassifiedHint}>{t.unclassified}</Term>}
          amount={f.unclassified}
          note={t.unclassifiedNote}
        />
      )}
      {(byLine.length > 0 || outside) && (
        <ReportHistory level={3} title={byLine.length > 0 ? t.byLine : t.outside} count={byLine.length > 0 ? byLine.length : undefined}>
          {byLine.length > 0 && <BudgetLineTable rows={byLine} />}
          {outside && (
            <div>
              {byLine.length > 0 && <h4 className="eyebrow border-b border-hairline pb-2 text-muted">{t.outside}</h4>}
              {f.occupancy > 0 && <OnePagerRow label={t.occupancy} amount={f.occupancy} note={t.occupancyNote} />}
              {f.otherOpex > 0 && <OnePagerRow label={t.otherOpex} amount={f.otherOpex} />}
            </div>
          )}
        </ReportHistory>
      )}
    </OnePagerSection>
  );
}

// Budget and what is left, per line, with the contingency reserve
// (v_project_budget_lines). Two figures only, so it fits half a page; paid
// and committed per line are one click away in Κινήσεις.
function BudgetLineTable({ rows }: { rows: BudgetLineRow[] }) {
  const t = el.budgetLines;
  const p = el.projectPage.budget;
  return (
    <SpecTable label={t.title} tableClassName="text-small">
      <thead>
        <tr>
          <Th>
            <span className="sr-only">{t.title}</span>
          </Th>
          <Th numeric>{p.budget}</Th>
          <Th numeric>{p.remaining}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const remaining = Number(r.remaining ?? 0);
          const code = (r.line_code ?? "other") as keyof typeof t;
          return (
            <Tr key={r.line_code}>
              <Td>{r.label || (t[code] as string) || r.line_code}</Td>
              <Td numeric strong>
                {moneyOrDash(r.budget)}
              </Td>
              <Td numeric className={remaining < 0 ? "text-negative" : "text-ink"}>
                {formatMoney(remaining)}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </SpecTable>
  );
}

// «IRR έργου (χωρίς ΦΠΑ)» -- one line, in ΑΝΑΠΤΥΞΗ for a development and
// in ΕΣΟΔΑ otherwise (never both).
export function ProjectIrrRow({ irr }: { irr: number | null }) {
  const t = el.development;
  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-b border-hairline py-2 text-body ${
        irr != null && irr < 0 ? "border-l-2 border-l-negative pl-2.5" : ""
      }`}
    >
      <span className="flex items-center gap-1 text-text">
        <Term title={t.irrHint}>{t.irr}</Term>
      </span>
      <span className={`num font-medium ${irr != null && irr < 0 ? "text-negative" : "text-ink"}`}>
        {irr != null ? formatPercent(irr, { signed: true, fixed: true }) : "—"}
      </span>
    </div>
  );
}

// ΑΝΑΠΤΥΞΗ (own_development only): margin, margin %, IRR and the peak
// funding need; revenue and cost behind «▸».
export function DevelopmentSection({ result, truncated }: { result: DevelopmentResult; truncated: boolean }) {
  const t = el.development;
  return (
    <OnePagerSection title={t.title} subtitle={t.subtitle}>
      <OnePagerRow label={t.margin} amount={result.margin} negative={result.margin < 0} alert={result.margin < 0} />
      {result.marginPct != null && <OnePagerRow label={t.marginPct} amount={formatPercent(result.marginPct, { fixed: true })} />}
      <ProjectIrrRow irr={result.irr} />
      <OnePagerRow
        label={<Term title={t.peakNote}>{t.peak}</Term>}
        amount={result.peakFunding}
        note={result.peakFundingDate ? formatDate(result.peakFundingDate) : null}
      />
      <ReportHistory level={3} title={el.projectPage.development.revenueAndCost}>
        <div>
          <OnePagerRow label={t.revenue} amount={result.revenue} />
          <OnePagerRow label={t.cost} amount={result.cost} negative />
        </div>
      </ReportHistory>
      {truncated && (
        <Notice tone="warning" size="small" className="mt-2">
          {t.truncated}
        </Notice>
      )}
    </OnePagerSection>
  );
}

type Utility = Pick<
  Tables<"property_utilities">,
  "id" | "kind" | "provider" | "supply_number" | "contract_account" | "rf_code" | "meter_number" | "notes"
>;

// ΑΚΙΝΗΤΟ (ΚΟΣΤΟΣ ΧΡΗΣΗΣ, ΠΑΡΟΧΕΣ and ΑΝΑ ΜΗΝΑ in one): what using the
// property costs a month (rent and the settlements paid instead of rent),
// what it cost over the last 12 months, and its supply numbers -- payments
// quoting them are attributed to the property automatically (0027 +
// v_property_monthly_cost). «+ Παροχή» beside the title; the supplies, the
// months and the breakdown of the monthly cost behind «▸».
export function PropertySection({
  projectId: id,
  monthlyRent,
  settlements,
  utilities,
  months,
}: {
  projectId: string;
  monthlyRent: number;
  settlements: { label: string; amount_per_installment: number; installment_count: number | null; first_due_date: string }[];
  utilities: Utility[];
  // [YYYY-MM-01, paid] newest first, the last 12 months.
  months: [string, number][];
}) {
  const t = el.projectPage.property;
  const perMonth = monthlyRent + settlements.reduce((s, p) => s + Number(p.amount_per_installment ?? 0), 0);
  const lastYear = months.reduce((s, [, amount]) => s + amount, 0);
  const kindLabel = projectStrings.forms.utilityKind as Record<string, string>;
  const providers = [...new Set(utilities.map((u) => u.provider?.trim() || kindLabel[u.kind]))];
  return (
    <OnePagerSection title={t.title} actions={<UtilityFormModal action={saveUtility} args={[id, null]} />}>
      {perMonth > 0 && (
        <OnePagerRow label={t.perMonth} amount={perMonth} note={settlements.length > 0 ? t.perMonthSettlements : t.perMonthRent} />
      )}
      {months.length > 0 && <OnePagerRow label={<Term title={t.lastYearHint}>{t.lastYear}</Term>} amount={lastYear} />}

      {utilities.length > 0 && (
        <ReportHistory level={3} title={t.utilities} count={utilities.length} meta={providers.join(" · ")}>
          <div className="flex flex-col">
            {utilities.map((u) => (
              <div
                key={u.id}
                className="flex flex-col gap-2 border-b border-hairline py-2 text-body md:flex-row md:flex-wrap md:items-center md:gap-x-3"
              >
                <span className="text-small text-muted md:w-32">{kindLabel[u.kind]}</span>
                <span className="min-w-0 flex-1 break-words text-ink">
                  {u.provider && <span>{u.provider} · </span>}
                  <span className="num">{u.supply_number ?? "—"}</span>
                  {u.rf_code && <span className="num ml-2 text-small text-muted">{u.rf_code}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <UtilityFormModal
                    action={saveUtility}
                    args={[id, u.id]}
                    initial={{
                      kind: u.kind,
                      provider: u.provider,
                      supply_number: u.supply_number,
                      contract_account: u.contract_account,
                      rf_code: u.rf_code,
                      meter_number: u.meter_number,
                      notes: u.notes,
                    }}
                  />
                  <ArgsDeleteButton action={deleteUtility} args={[id, u.id]} />
                </span>
              </div>
            ))}
          </div>
        </ReportHistory>
      )}

      {months.length > 0 && (
        <ReportHistory level={3} title={t.byMonth} count={months.length}>
          {/* Newest first, each a link to that month's property costs. */}
          <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {months.map(([month, amount]) => (
              <li key={month}>
                <Link
                  href={`/projects/properties?month=${month.slice(0, 7)}`}
                  className="flex min-h-10 items-baseline justify-between gap-3 border-b border-hairline py-2 text-body hover:bg-hover"
                >
                  <span className="num text-text">{formatDate(month).slice(3)}</span>
                  <span className="num text-ink underline-offset-4 hover:underline">{formatMoney(amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </ReportHistory>
      )}

      {settlements.length > 0 && (
        <ReportHistory level={3} title={t.breakdown}>
          <div>
            {monthlyRent > 0 && <OnePagerRow label={t.rent} amount={monthlyRent} />}
            {settlements.map((p) => (
              <OnePagerRow
                key={p.label}
                label={p.label}
                amount={Number(p.amount_per_installment)}
                note={fillText(p.installment_count != null ? t.instalments : t.instalmentsFrom, {
                  count: String(p.installment_count ?? ""),
                  date: formatDate(p.first_due_date),
                })}
              />
            ))}
          </div>
        </ReportHistory>
      )}
    </OnePagerSection>
  );
}

// «Συγχρονισμός μισθωμάτων»: a text button in the header's link row
// (indexed rent only); re-writes the lease's payment schedule into the
// ledger. Any error shows under it.
export function LeaseSyncButton({ leaseId }: { leaseId: string }) {
  return (
    <ArgsActionForm action={syncLeaseScheduleAction} args={[leaseId]} className="inline-flex flex-wrap items-center gap-x-2">
      <button type="submit" className="inline-flex items-center text-ink underline-offset-4 hover:underline max-md:min-h-11">
        {el.projectFinance.syncLease}
      </button>
    </ArgsActionForm>
  );
}
