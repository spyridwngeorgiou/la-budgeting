"use client";

import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import type { Tables } from "@/lib/db/types";
import {
  BUSINESS_MODEL,
  CAPITAL_SOURCE_KIND,
  LIABILITY_STATE,
  OPEX_LINE_KIND,
  PROJECT_NOTE_KIND_ACTIVE,
  PROJECT_NOTE_SEVERITY,
  PROJECT_STATUS,
  PROJECT_TYPE,
  type OpexLineKind,
} from "@/lib/domain/enums";

// The project page's edit forms, as bare field sets, wrapped in a modal by
// ./LegacyFormModals.tsx.
// Field names are the server actions' contract (actions.ts,
// [id]/finance-actions.ts, [id]/scenario-actions.ts) -- keep them.

const pct = (v: number | null | undefined, fallback: number | "") => (v != null ? v * 100 : fallback);
const two = "grid grid-cols-2 gap-3";
const f = projects.forms;

// What a form starts from: any subset of its row (the DB row types, so a
// page passes the row it read).
type Initial<T, K extends keyof T> = Partial<Pick<T, K>>;

// ── Project ───────────────────────────────────────────────────────────────────

export type ProjectInitial = Initial<
  Tables<"projects">,
  "code" | "display_name" | "project_type" | "status" | "business_model" | "start_date" | "contract_value" | "contract_signed_date"
>;

export function ProjectFields({ initial }: { initial?: ProjectInitial }) {
  return (
    <>
      <Field label={el.project.code}>
        <Input name="code" defaultValue={initial?.code} required readOnly={!!initial?.code} />
      </Field>
      <Field label={el.project.name}>
        <Input name="display_name" defaultValue={initial?.display_name} required />
      </Field>
      <div className={two}>
        <Field label="Τύπος Έργου">
          <Select name="project_type" defaultValue={initial?.project_type ?? ""}>
            <option value="">—</option>
            {PROJECT_TYPE.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={el.project.status}>
          <Select name="status" defaultValue={initial?.status ?? "active"}>
            {PROJECT_STATUS.map((s) => (
              <option key={s} value={s}>
                {el.project.statusValues[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className={two}>
        <Field label="Μοντέλο">
          <Select name="business_model" defaultValue={initial?.business_model ?? ""}>
            <option value="">—</option>
            {BUSINESS_MODEL.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ημ/νία Έναρξης">
          <Input type="date" name="start_date" defaultValue={initial?.start_date ?? ""} />
        </Field>
      </div>
      <div className={two}>
        <Field label="Συμβατική Αξία (€) — έργο πελάτη">
          <Input type="number" step="0.01" name="contract_value" defaultValue={initial?.contract_value ?? ""} />
        </Field>
        <Field label="Ημ/νία Υπογραφής Σύμβασης">
          <Input type="date" name="contract_signed_date" defaultValue={initial?.contract_signed_date ?? ""} />
        </Field>
      </div>
    </>
  );
}

// ── Budget ────────────────────────────────────────────────────────────────────

export type BudgetLineCode = "acquisition" | "studies_permits_legal" | "construction_equipment" | "other";
const BUDGET_LINES: BudgetLineCode[] = ["acquisition", "studies_permits_legal", "construction_equipment", "other"];

export interface BudgetInitial {
  contingency_pct?: number;
  lines?: Partial<Record<BudgetLineCode, number>>;
}

export function BudgetFields({ initial }: { initial?: BudgetInitial }) {
  return (
    <>
      {BUDGET_LINES.map((code) => (
        <Field key={code} label={el.budgetLines[code]}>
          <Input type="number" step="0.01" name={`line_${code}`} defaultValue={initial?.lines?.[code]} />
        </Field>
      ))}
      <Field label="Απρόβλεπτα (%)">
        <Input type="number" step="0.01" name="contingency_pct" defaultValue={initial?.contingency_pct ?? 0} />
      </Field>
    </>
  );
}

// ── Status / risk note ────────────────────────────────────────────────────────

// Status and risk only since 0041: actions and milestones are planner tasks.
export const NOTE_SEVERITY_LABELS = f.noteSeverity;
export type ProjectNoteInitial = Initial<Tables<"project_notes">, "id" | "kind" | "severity" | "body" | "exposure_amount" | "due_date">;

export function NoteFields({ initial }: { initial?: ProjectNoteInitial }) {
  return (
    <>
      <div className={two}>
        <Field label="Τύπος">
          <Select name="kind" defaultValue={initial?.kind ?? "status"}>
            {PROJECT_NOTE_KIND_ACTIVE.map((k) => (
              <option key={k} value={k}>
                {f.noteKind[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Σοβαρότητα">
          <Select name="severity" defaultValue={initial?.severity ?? "info"}>
            {PROJECT_NOTE_SEVERITY.map((s) => (
              <option key={s} value={s}>
                {NOTE_SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Κείμενο">
        <Textarea name="body" defaultValue={initial?.body ?? ""} rows={3} required />
      </Field>
      <div className={two}>
        <Field label="Έκθεση (€, προαιρετικό)">
          <Input type="number" step="0.01" name="exposure_amount" defaultValue={initial?.exposure_amount ?? ""} />
        </Field>
        <Field label="Προθεσμία">
          <Input type="date" name="due_date" defaultValue={initial?.due_date ?? ""} />
        </Field>
      </div>
    </>
  );
}

// ── Capital source ────────────────────────────────────────────────────────────

export const CAPITAL_KIND_LABELS = f.capitalKind;
export type CapitalSourceInitial = Initial<Tables<"project_capital_sources">, "id" | "kind" | "contributor" | "amount" | "contributed_on" | "notes">;

export function CapitalFields({ initial }: { initial?: CapitalSourceInitial }) {
  return (
    <>
      <Field label="Είδος">
        <Select name="kind" defaultValue={initial?.kind ?? "equity"}>
          {CAPITAL_SOURCE_KIND.map((k) => (
            <option key={k} value={k}>
              {CAPITAL_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Από ποιον">
        <Input name="contributor" defaultValue={initial?.contributor ?? ""} placeholder="π.χ. Σπύρος, Συνεπενδυτής Χ" />
      </Field>
      <div className={two}>
        <Field label="Ποσό (€)">
          <Input type="number" step="0.01" name="amount" defaultValue={initial?.amount} required />
        </Field>
        <Field label="Ημερομηνία εισφοράς">
          <Input type="date" name="contributed_on" defaultValue={initial?.contributed_on} required />
        </Field>
      </div>
      <Field label="Σημειώσεις">
        <Textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} />
      </Field>
    </>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

export const UTILITY_KIND_LABELS = f.utilityKind;
export type UtilityInitial = Initial<
  Tables<"property_utilities">,
  "kind" | "provider" | "supply_number" | "contract_account" | "rf_code" | "meter_number" | "notes"
>;

export function UtilityFields({ initial }: { initial?: UtilityInitial }) {
  return (
    <>
      <div className={two}>
        <Field label="Είδος">
          <Select name="kind" defaultValue={initial?.kind ?? "electricity"}>
            {Object.entries(UTILITY_KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Πάροχος">
          <Input name="provider" defaultValue={initial?.provider ?? ""} placeholder="ΔΕΗ, ΕΥΔΑΠ, Cosmote…" />
        </Field>
      </div>
      <Field label="Αριθμός παροχής / γραμμής">
        <Input name="supply_number" defaultValue={initial?.supply_number ?? ""} placeholder="π.χ. 6 04185949-04 9" />
      </Field>
      <div className={two}>
        <Field label="Λογ. συμβολαίου">
          <Input name="contract_account" defaultValue={initial?.contract_account ?? ""} />
        </Field>
        <Field label="Μετρητής">
          <Input name="meter_number" defaultValue={initial?.meter_number ?? ""} />
        </Field>
      </div>
      <Field label="Κωδικός πληρωμής RF">
        <Input name="rf_code" defaultValue={initial?.rf_code ?? ""} />
      </Field>
      <Field label="Σημειώσεις" hint={f.hint.utility}>
        <Input name="notes" defaultValue={initial?.notes ?? ""} />
      </Field>
    </>
  );
}

// ── Loan tranche ──────────────────────────────────────────────────────────────

export const LOAN_STATE_LABELS = f.loanState;
export type LoanInitial = Initial<
  Tables<"loans">,
  "id" | "label" | "principal" | "interest_rate" | "term_years" | "grace_years" | "first_amortisation_month" | "state" | "notes"
> & { drawdowns?: { scheduled_month: string; amount: number; done: boolean }[] };

let nextKey = 1;

// Mounted with the dialog, so the drawdown rows start from `initial` on
// every open.
export function LoanFields({ initial }: { initial?: LoanInitial }) {
  const [rows, setRows] = useState(() =>
    (initial?.drawdowns ?? []).map((d) => ({ key: nextKey++, month: d.scheduled_month.slice(0, 7), amount: String(d.amount), done: d.done })),
  );
  const patch = (i: number, change: Partial<(typeof rows)[number]>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...change } : x)));
  return (
    <>
      <input type="hidden" name="drawdowns_present" value="1" />
      <Field label="Ετικέτα">
        <Input name="label" defaultValue={initial?.label} required />
      </Field>
      <div className={two}>
        <Field label="Κεφάλαιο (€)">
          <Input type="number" step="0.01" name="principal" defaultValue={initial?.principal} required />
        </Field>
        <Field label="Επιτόκιο (ετήσιο, %)">
          <Input type="number" step="0.001" name="interest_rate_pct" defaultValue={pct(initial?.interest_rate, "")} required />
        </Field>
      </div>
      <div className={two}>
        <Field label="Διάρκεια (έτη)">
          <Input type="number" name="term_years" defaultValue={initial?.term_years} required />
        </Field>
        <Field label="Χάρη (έτη)">
          <Input type="number" step="0.5" name="grace_years" defaultValue={initial?.grace_years ?? 0} />
        </Field>
      </div>
      <Field label="Πρώτος μήνας εξόφλησης">
        <Input type="date" name="first_amortisation_month" defaultValue={initial?.first_amortisation_month ?? ""} />
      </Field>
      <Field label="Κατάσταση" hint={f.hint.loanState}>
        <Select name="state" defaultValue={initial?.state ?? "in_application"}>
          {LIABILITY_STATE.map((s) => (
            <option key={s} value={s}>
              {LOAN_STATE_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="flex flex-col gap-2 border-t border-hairline pt-3">
        <legend className="eyebrow text-muted">Εκταμιεύσεις</legend>
        {rows.length === 0 && <p className="text-small text-muted">Καμία ακόμα. Χωρίς εκταμίευση δεν υπάρχουν δόσεις.</p>}
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
            <Input type="month" name="drawdown_month" aria-label="Μήνας εκταμίευσης" value={r.month} onChange={(e) => patch(i, { month: e.target.value })} />
            <Input
              type="number"
              step="0.01"
              name="drawdown_amount"
              aria-label="Ποσό εκταμίευσης"
              value={r.amount}
              onChange={(e) => patch(i, { amount: e.target.value })}
            />
            <label className="flex items-center gap-1 text-small text-text">
              <input type="hidden" name="drawdown_done" value={r.done ? "1" : "0"} />
              <input type="checkbox" className="accent-navy" checked={r.done} onChange={(e) => patch(i, { done: e.target.checked })} />
              έγινε
            </label>
            <Button type="button" variant="ghost" size="sm" aria-label="Αφαίρεση εκταμίευσης" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ×
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setRows([...rows, { key: nextKey++, month: "", amount: "", done: false }])}
          >
            + Εκταμίευση
          </Button>
        </div>
      </fieldset>

      <Field label="Σημειώσεις">
        <Textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} />
      </Field>
    </>
  );
}

// ── Scenario assumptions ──────────────────────────────────────────────────────

export type ScenarioInitial = Initial<
  Tables<"project_scenarios">,
  | "name"
  | "flat_annual_revenue"
  | "revenue_growth_pct"
  | "opex_growth_pct"
  | "growth_starts_after_operating_year"
  | "discount_rate_pct"
  | "dscr_covenant_min"
  | "adr_multiplier"
  | "notes"
>;
const HINT = f.hint;

export function ScenarioFields({ initial }: { initial?: ScenarioInitial }) {
  return (
    <>
      <Field label="Όνομα Σεναρίου">
        <Input name="name" defaultValue={initial?.name ?? "Βασικό"} required />
      </Field>
      <Field label="Σταθερός ετήσιος τζίρος (€, αν δεν υπάρχει ανάλυση εσόδων)">
        <Input type="number" step="0.01" name="flat_annual_revenue" defaultValue={initial?.flat_annual_revenue ?? ""} />
      </Field>
      <div className={two}>
        <Field label="Ανάπτυξη εσόδων (%/έτος)">
          <Input type="number" step="0.01" name="revenue_growth_pct_pct" defaultValue={pct(initial?.revenue_growth_pct, 0)} />
        </Field>
        <Field label="Ανάπτυξη opex (%/έτος)" hint={HINT.opex}>
          <Input type="number" step="0.01" name="opex_growth_pct_pct" defaultValue={pct(initial?.opex_growth_pct, 0)} />
        </Field>
      </div>
      <Field label="Η ανάπτυξη ξεκινά μετά το λειτουργικό έτος">
        <Input type="number" min={0} name="growth_starts_after_operating_year" defaultValue={initial?.growth_starts_after_operating_year ?? 3} />
      </Field>
      <div className={two}>
        <Field label="Προεξοφλητικό επιτόκιο (%)" hint={HINT.discount}>
          <Input type="number" step="0.01" name="discount_rate_pct_pct" defaultValue={pct(initial?.discount_rate_pct, 9)} />
        </Field>
        <Field label="Ελάχιστο DSCR" hint={HINT.dscr}>
          <Input type="number" step="0.01" name="dscr_covenant_min" defaultValue={initial?.dscr_covenant_min ?? 1.2} />
        </Field>
      </div>
      <Field label="ADR σε σχέση με την ανάλυση (%)" hint={HINT.adr}>
        <Input
          type="number"
          step="1"
          min="1"
          name="adr_multiplier_pct"
          defaultValue={initial?.adr_multiplier != null ? Math.round(initial.adr_multiplier * 100) : 100}
        />
      </Field>
      <Field label="Σημειώσεις">
        <Textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} />
      </Field>
    </>
  );
}

// ── Opex line ─────────────────────────────────────────────────────────────────

export const OPEX_KIND_LABELS = f.opexKind;
export type OpexLineInitial = Partial<Omit<Tables<"opex_lines">, "org_id" | "scenario_id" | "category_id" | "sort_order" | "grows_with_opex_growth">>;

// Same three shapes the DB constraints enforce (opex_payroll_shape /
// opex_pct_shape / opex_fixed_shape, 0021): only the fields of the chosen
// kind are shown.
export function OpexFields({ initial }: { initial?: OpexLineInitial }) {
  const [kind, setKind] = useState<OpexLineKind>(initial?.kind ?? "fixed_annual");
  return (
    <>
      <Field label="Ετικέτα">
        <Input name="label" defaultValue={initial?.label} required />
      </Field>
      <Field label="Τύπος">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as OpexLineKind)}>
          {OPEX_LINE_KIND.map((k) => (
            <option key={k} value={k}>
              {OPEX_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      {kind === "payroll" && (
        <>
          <div className={two}>
            <Field label="Θέσεις (headcount)">
              <Input type="number" step="0.01" name="headcount" defaultValue={initial?.headcount ?? ""} required />
            </Field>
            <Field label="Μηνιαίος μισθός (€)">
              <Input type="number" step="0.01" name="monthly_wage" defaultValue={initial?.monthly_wage ?? ""} required />
            </Field>
          </div>
          <div className={two}>
            <Field label="Μισθοί/έτος (π.χ. 14)">
              <Input type="number" step="0.5" name="salaries_per_year" defaultValue={initial?.salaries_per_year ?? 14} required />
            </Field>
            <Field label="Μήνες ενεργό">
              <Input type="number" min={1} max={12} name="months_active" defaultValue={initial?.months_active ?? 12} required />
            </Field>
          </div>
          <div className={two}>
            <Field label="Εργοδοτικές εισφορές (%)">
              <Input type="number" step="0.01" name="employer_contribution_pct_pct" defaultValue={pct(initial?.employer_contribution_pct, 21.79)} />
            </Field>
            <Field label="Πριμ νυχτ./αργιών (%)">
              <Input type="number" step="0.01" name="premium_pct_pct" defaultValue={pct(initial?.premium_pct, 0)} />
            </Field>
          </div>
        </>
      )}

      {kind === "pct_of_revenue" && (
        <Field label="Ποσοστό επί τζίρου (%)">
          <Input type="number" step="0.01" name="pct_of_revenue_pct" defaultValue={pct(initial?.pct_of_revenue, "")} required />
        </Field>
      )}

      {kind === "fixed_annual" && (
        <Field label="Ετήσιο ποσό (€)">
          <Input type="number" step="0.01" name="annual_amount" defaultValue={initial?.annual_amount ?? ""} required />
        </Field>
      )}

      <div className={two}>
        <Field label="Από λειτουργικό έτος">
          <Input type="number" min={1} name="from_operating_year" defaultValue={initial?.from_operating_year ?? 1} required />
        </Field>
        <Field label="Έως λειτουργικό έτος (προαιρετικό)">
          <Input type="number" min={1} name="to_operating_year" defaultValue={initial?.to_operating_year ?? ""} />
        </Field>
      </div>
      <Field label="Σημείωση">
        <Input name="note" defaultValue={initial?.note ?? ""} />
      </Field>
    </>
  );
}
