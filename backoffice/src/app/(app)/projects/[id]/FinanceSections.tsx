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
  return (
    <div className="mt-2 border-t border-line/60 pt-2">
      <div className="mb-1 text-xs font-medium text-ink-muted">{t.title}</div>
      <table className="w-full text-xs">
        <tbody>
          {visible.map((r) => {
            const remaining = Number(r.remaining ?? 0);
            const code = (r.line_code ?? "other") as keyof typeof t;
            return (
              <tr key={r.line_code} className="border-t border-line/40 first:border-0">
                <td className="py-1 pr-2">{r.label || (t[code] as string) || r.line_code}</td>
                <td className="py-1 pr-2 text-right font-mono">{formatMoney(r.budget ?? 0)}</td>
                <td className="py-1 pr-2 text-right font-mono text-ink-muted" title={t.spent}>
                  {formatMoney(Number(r.paid ?? 0) + Number(r.committed ?? 0))}
                </td>
                <td className={`py-1 text-right font-mono ${remaining < 0 ? "text-red-ink" : ""}`} title={t.left}>
                  {formatMoney(remaining)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {visible.some((r) => r.line_code === "contingency") && <p className="mt-1 text-[11px] text-ink-faint">{t.contingencyNote}</p>}
    </div>
  );
}

// «IRR έργου (χωρίς ΦΠΑ)» -- one line, shared by ΚΕΦΑΛΑΙΟ and the
// development block.
export function ProjectIrrRow({ irr }: { irr: number | null }) {
  const t = el.development;
  return (
    <div className="flex items-center justify-between border-t border-line/60 pt-1.5 text-sm">
      <span className="flex items-center gap-1">
        <Term title={t.irrHint}>{t.irr}</Term>
      </span>
      <span className={`font-mono font-medium ${irr != null && irr < 0 ? "text-red-ink" : "text-sage-ink"}`}>
        {irr != null ? `${(irr * 100).toFixed(1)}%` : "—"}
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
      <OnePagerRow label={t.margin} amount={result.margin} negative={result.margin < 0} emphasis />
      {result.marginPct != null && <OnePagerRow label={t.marginPct} amount={`${(result.marginPct * 100).toFixed(1)}%`} />}
      <OnePagerRow
        label={t.peak}
        amount={result.peakFunding}
        note={result.peakFundingDate ? `${t.peakNote} · ${formatDate(result.peakFundingDate)}` : null}
      />
      <ProjectIrrRow irr={result.irr} />
      {truncated && <p className="pt-1 text-xs text-amber-ink">{t.truncated}</p>}
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
    <div className="mt-2 flex flex-col gap-2 border-t border-line/60 pt-2">
      <div className="text-xs font-medium text-ink-muted">{t.title}</div>
      <p className="text-xs text-ink-faint">{t.hint}</p>
      <ActionForm action={sendScenarioToCash.bind(null, projectId, scenarioId)} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t.months}
          <Select name="months" defaultValue="24">
            {[12, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} {t.monthsUnit}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t.probability}
          <Input type="number" name="probability_pct" min="1" max="100" step="5" defaultValue={80} className="w-24" />
        </label>
        <Button type="submit" variant="secondary">
          {sentCount > 0 ? t.resend : t.send}
        </Button>
      </ActionForm>
      {sentCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>
            {sentCount} {t.sent}
          </span>
          <ActionForm action={removeScenarioFromCash.bind(null, projectId, scenarioId)}>
            <button type="submit" className="underline">
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
      <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
        {el.projectFinance.syncLease}
      </Button>
    </ActionForm>
  );
}
