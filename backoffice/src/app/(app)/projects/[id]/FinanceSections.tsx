import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import { ActionForm } from "@/components/ActionForm";
import { Button, Select, Input, Term } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import type { DevelopmentResult } from "@/lib/finance/development";
import { syncLeaseScheduleAction } from "./finance-actions";
import { removeScenarioFromCash, sendScenarioToCash } from "./scenario-actions";

// Blocks of the project one-pager that read the finance layer (0069,
// development.ts, «Στείλε στο ταμείο»). Server components; the figures come
// in computed, these only lay them out.

const LINE_ORDER = ["acquisition", "studies_permits_legal", "construction_equipment", "other", "contingency"] as const;

export interface BudgetLineRow {
  line_code: string | null;
  label: string | null;
  budget: number | null;
  paid: number | null;
  committed: number | null;
  remaining: number | null;
}

// Budget vs actual per line, with the contingency reserve (v_project_budget_lines).
export function BudgetLineRows({ rows }: { rows: BudgetLineRow[] }) {
  const t = el.budgetLines;
  const visible = rows
    .filter((r) => Number(r.budget ?? 0) !== 0 || Number(r.paid ?? 0) + Number(r.committed ?? 0) !== 0)
    .sort(
      (a, b) =>
        LINE_ORDER.indexOf(a.line_code as (typeof LINE_ORDER)[number]) -
        LINE_ORDER.indexOf(b.line_code as (typeof LINE_ORDER)[number]),
    );
  if (visible.length === 0) return null;
  // A small spec table: uppercase head over the navy rule, hairline rows,
  // figures right-aligned; scrolls inside its frame on a phone.
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="eyebrow pb-2 text-left text-muted">{t.title}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-rule py-2 pr-3 text-left">
                <span className="sr-only">{t.title}</span>
              </th>
              <th scope="col" className="eyebrow border-b border-rule py-2 pr-3 text-right font-medium text-muted">
                {el.project.budget}
              </th>
              <th scope="col" className="eyebrow border-b border-rule py-2 pr-3 text-right font-medium text-muted">
                {t.spent}
              </th>
              <th scope="col" className="eyebrow border-b border-rule py-2 text-right font-medium text-muted">
                {t.left}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const remaining = Number(r.remaining ?? 0);
              const code = (r.line_code ?? "other") as keyof typeof t;
              return (
                <tr key={r.line_code}>
                  <td className="border-b border-hairline py-2 pr-3 text-text">{r.label || (t[code] as string) || r.line_code}</td>
                  <td className="num border-b border-hairline py-2 pr-3 text-right text-ink">{formatMoney(r.budget ?? 0)}</td>
                  <td className="num border-b border-hairline py-2 pr-3 text-right text-text" title={t.spent}>
                    {formatMoney(Number(r.paid ?? 0) + Number(r.committed ?? 0))}
                  </td>
                  <td className={`num border-b border-hairline py-2 text-right ${remaining < 0 ? "text-negative" : "text-ink"}`} title={t.left}>
                    {formatMoney(remaining)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.some((r) => r.line_code === "contingency") && <p className="text-small text-muted">{t.contingencyNote}</p>}
    </div>
  );
}

// «IRR έργου (χωρίς ΦΠΑ)» -- one line, shared by ΚΕΦΑΛΑΙΟ and the
// development block.
export function ProjectIrrRow({ irr }: { irr: number | null }) {
  const t = el.development;
  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-b border-hairline py-2 text-sm ${
        irr != null && irr < 0 ? "border-l-2 border-l-negative pl-2.5" : ""
      }`}
    >
      <span className="flex items-center gap-1 text-text">
        <Term title={t.irrHint}>{t.irr}</Term>
      </span>
      <span className={`num font-medium ${irr != null && irr < 0 ? "text-negative" : "text-ink"}`}>
        {irr != null ? `${irr > 0 ? "+" : irr < 0 ? "−" : ""}${Math.abs(irr * 100).toFixed(1)}%` : "—"}
      </span>
    </div>
  );
}

// Development and sale: margin, XIRR and the peak funding need.
export function DevelopmentSection({ result, truncated }: { result: DevelopmentResult; truncated: boolean }) {
  const t = el.development;
  return (
    <OnePagerSection title={t.title} subtitle={t.subtitle}>
      <OnePagerRow label={t.revenue} amount={result.revenue} />
      <OnePagerRow label={t.cost} amount={result.cost} negative />
      <OnePagerRow label={t.margin} amount={result.margin} negative={result.margin < 0} alert={result.margin < 0} emphasis />
      {result.marginPct != null && <OnePagerRow label={t.marginPct} amount={`${(result.marginPct * 100).toFixed(1)}%`} />}
      <OnePagerRow
        label={t.peak}
        amount={result.peakFunding}
        note={result.peakFundingDate ? `${t.peakNote} · ${formatDate(result.peakFundingDate)}` : null}
      />
      <ProjectIrrRow irr={result.irr} />
      {truncated && <p className="mt-2 border-l-2 border-warning pl-3 text-small text-text">{t.truncated}</p>}
    </OnePagerSection>
  );
}

// «Στείλε στο ταμείο»: the scenario's monthly revenue and opex into the
// cash forecast as expected rows.
export function SendToCashSection({
  projectId,
  scenarioId,
  sentCount,
}: {
  projectId: string;
  scenarioId: string;
  sentCount: number;
}) {
  const t = el.sendToCash;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <h3 className="eyebrow border-b border-hairline pb-2 text-muted">{t.title}</h3>
      <p className="text-small text-muted">{t.hint}</p>
      <ActionForm action={sendScenarioToCash.bind(null, projectId, scenarioId)} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-small text-muted">
          {t.months}
          <Select name="months" defaultValue="24" className="max-md:min-h-11">
            {[12, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} {t.monthsUnit}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-small text-muted">
          {t.probability}
          <Input type="number" name="probability_pct" min="1" max="100" step="5" defaultValue={80} className="num w-24 max-md:min-h-11" />
        </label>
        <Button type="submit" variant="secondary" className="max-md:min-h-11">
          {sentCount > 0 ? t.resend : t.send}
        </Button>
      </ActionForm>
      {sentCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-small text-muted">
          <span className="num">
            {sentCount} {t.sent}
          </span>
          <ActionForm action={removeScenarioFromCash.bind(null, projectId, scenarioId)}>
            <button type="submit" className="inline-flex min-h-10 items-center text-ink underline underline-offset-4 max-md:min-h-11">
              {t.remove}
            </button>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

export function LeaseSyncButton({ leaseId }: { leaseId: string }) {
  return (
    <ActionForm action={syncLeaseScheduleAction.bind(null, leaseId)}>
      <Button type="submit" variant="secondary" className="max-md:min-h-11">
        {el.projectFinance.syncLease}
      </Button>
    </ActionForm>
  );
}
