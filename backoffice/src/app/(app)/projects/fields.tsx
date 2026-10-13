"use client";

import { useId, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import type { Tables } from "@/lib/db/types";
import {
  BUSINESS_MODEL,
  LIABILITY_STATE,
  OPEX_LINE_KIND,
  PROJECT_NOTE_KIND_ACTIVE,
  PROJECT_NOTE_SEVERITY,
  PROJECT_STATUS,
  PROJECT_TYPE,
  type OpexLineKind,
} from "@/lib/domain/enums";

// The project page's edit forms, as bare field sets, wrapped in a drawer by
// ./LegacyFormModals.tsx.
// Field names are the server actions' contract (actions.ts,
// [id]/finance-actions.ts, [id]/scenario-actions.ts) -- keep them.
// A required control has `required` on its Field too (the «*»), and every
// label points at its control (htmlFor), so a click on it focuses the field.

const pct = (v: number | null | undefined, fallback: number | "") => (v != null ? v * 100 : fallback);
// Two fields side by side from sm up, stacked on a phone's sheet.
const two = "grid grid-cols-1 gap-4 sm:grid-cols-2";
const f = projects.forms;

// One id per control of a mounted form (useId), so two forms never share one.
function useIds() {
  const base = useId();
  return (name: string) => `${base}-${name}`;
}

// What a form starts from: any subset of its row (the DB row types, so a
// page passes the row it read).
type Initial<T, K extends keyof T> = Partial<Pick<T, K>>;

// ── Project ───────────────────────────────────────────────────────────────────

export type ProjectInitial = Initial<
  Tables<"projects">,
  "code" | "display_name" | "project_type" | "status" | "business_model" | "start_date" | "contract_value" | "contract_signed_date"
>;

export function ProjectFields({ initial }: { initial?: ProjectInitial }) {
  const id = useIds();
  return (
    <>
      <Field label={el.project.code} htmlFor={id("code")} required>
        <Input id={id("code")} name="code" defaultValue={initial?.code} required readOnly={!!initial?.code} />
      </Field>
      <Field label={el.project.name} htmlFor={id("name")} required>
        <Input id={id("name")} name="display_name" defaultValue={initial?.display_name} required />
      </Field>
      <div className={two}>
        <Field label="Τύπος Έργου" htmlFor={id("type")}>
          <Select id={id("type")} name="project_type" defaultValue={initial?.project_type ?? ""}>
            <option value="">—</option>
            {PROJECT_TYPE.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={el.project.status} htmlFor={id("status")}>
          <Select id={id("status")} name="status" defaultValue={initial?.status ?? "active"}>
            {PROJECT_STATUS.map((s) => (
              <option key={s} value={s}>
                {el.project.statusValues[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className={two}>
        <Field label="Μοντέλο" htmlFor={id("model")}>
          <Select id={id("model")} name="business_model" defaultValue={initial?.business_model ?? ""}>
            <option value="">—</option>
            {BUSINESS_MODEL.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ημ/νία Έναρξης" htmlFor={id("start")}>
          <Input id={id("start")} type="date" name="start_date" defaultValue={initial?.start_date ?? ""} />
        </Field>
      </div>
      <div className={two}>
        <Field label="Συμβατική Αξία (€) — έργο πελάτη" htmlFor={id("contract")}>
          <Input id={id("contract")} type="number" step="0.01" name="contract_value" defaultValue={initial?.contract_value ?? ""} />
        </Field>
        <Field label="Ημ/νία Υπογραφής Σύμβασης" htmlFor={id("signed")}>
          <Input id={id("signed")} type="date" name="contract_signed_date" defaultValue={initial?.contract_signed_date ?? ""} />
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
  const id = useIds();
  return (
    <>
      {BUDGET_LINES.map((code) => (
        <Field key={code} label={el.budgetLines[code]} htmlFor={id(code)}>
          <Input id={id(code)} type="number" step="0.01" name={`line_${code}`} defaultValue={initial?.lines?.[code]} />
        </Field>
      ))}
      <Field label="Απρόβλεπτα (%)" htmlFor={id("contingency")}>
        <Input id={id("contingency")} type="number" step="0.01" name="contingency_pct" defaultValue={initial?.contingency_pct ?? 0} />
      </Field>
    </>
  );
}

// ── Status / risk note ────────────────────────────────────────────────────────

// Status and risk only since 0041: actions and milestones are planner tasks.
export const NOTE_SEVERITY_LABELS = f.noteSeverity;
export type ProjectNoteInitial = Initial<Tables<"project_notes">, "id" | "kind" | "severity" | "body" | "exposure_amount" | "due_date">;

export function NoteFields({ initial }: { initial?: ProjectNoteInitial }) {
  const id = useIds();
  return (
    <>
      <div className={two}>
        <Field label="Τύπος" htmlFor={id("kind")}>
          <Select id={id("kind")} name="kind" defaultValue={initial?.kind ?? "status"}>
            {PROJECT_NOTE_KIND_ACTIVE.map((k) => (
              <option key={k} value={k}>
                {f.noteKind[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Σοβαρότητα" htmlFor={id("severity")}>
          <Select id={id("severity")} name="severity" defaultValue={initial?.severity ?? "info"}>
            {PROJECT_NOTE_SEVERITY.map((s) => (
              <option key={s} value={s}>
                {NOTE_SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Κείμενο" htmlFor={id("body")} required>
        <Textarea id={id("body")} name="body" defaultValue={initial?.body ?? ""} rows={3} required />
      </Field>
      <div className={two}>
        <Field label="Έκθεση (€, προαιρετικό)" htmlFor={id("exposure")}>
          <Input id={id("exposure")} type="number" step="0.01" name="exposure_amount" defaultValue={initial?.exposure_amount ?? ""} />
        </Field>
        <Field label="Προθεσμία" htmlFor={id("due")}>
          <Input id={id("due")} type="date" name="due_date" defaultValue={initial?.due_date ?? ""} />
        </Field>
      </div>
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
  const id = useIds();
  return (
    <>
      <div className={two}>
        <Field label="Είδος" htmlFor={id("kind")}>
          <Select id={id("kind")} name="kind" defaultValue={initial?.kind ?? "electricity"}>
            {Object.entries(UTILITY_KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Πάροχος" htmlFor={id("provider")}>
          <Input id={id("provider")} name="provider" defaultValue={initial?.provider ?? ""} placeholder="ΔΕΗ, ΕΥΔΑΠ, Cosmote…" />
        </Field>
      </div>
      <Field label="Αριθμός παροχής / γραμμής" htmlFor={id("supply")}>
        <Input id={id("supply")} name="supply_number" defaultValue={initial?.supply_number ?? ""} placeholder="π.χ. 6 04185949-04 9" />
      </Field>
      <div className={two}>
        <Field label="Λογ. συμβολαίου" htmlFor={id("account")}>
          <Input id={id("account")} name="contract_account" defaultValue={initial?.contract_account ?? ""} />
        </Field>
        <Field label="Μετρητής" htmlFor={id("meter")}>
          <Input id={id("meter")} name="meter_number" defaultValue={initial?.meter_number ?? ""} />
        </Field>
      </div>
      <Field label="Κωδικός πληρωμής RF" htmlFor={id("rf")}>
        <Input id={id("rf")} name="rf_code" defaultValue={initial?.rf_code ?? ""} />
      </Field>
      <Field label="Σημειώσεις" hint={f.hint.utility} htmlFor={id("notes")}>
        <Input id={id("notes")} name="notes" defaultValue={initial?.notes ?? ""} />
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
  const id = useIds();
  const [rows, setRows] = useState(() =>
    (initial?.drawdowns ?? []).map((d) => ({ key: nextKey++, month: d.scheduled_month.slice(0, 7), amount: String(d.amount), done: d.done })),
  );
  const patch = (i: number, change: Partial<(typeof rows)[number]>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...change } : x)));
  return (
    <>
      <input type="hidden" name="drawdowns_present" value="1" />
      <Field label="Ετικέτα" htmlFor={id("label")} required>
        <Input id={id("label")} name="label" defaultValue={initial?.label} required />
      </Field>
      <div className={two}>
        <Field label="Κεφάλαιο (€)" htmlFor={id("principal")} required>
          <Input id={id("principal")} type="number" step="0.01" name="principal" defaultValue={initial?.principal} required />
        </Field>
        <Field label="Επιτόκιο (ετήσιο, %)" htmlFor={id("rate")} required>
          <Input id={id("rate")} type="number" step="0.001" name="interest_rate_pct" defaultValue={pct(initial?.interest_rate, "")} required />
        </Field>
      </div>
      <div className={two}>
        <Field label="Διάρκεια (έτη)" htmlFor={id("term")} required>
          <Input id={id("term")} type="number" name="term_years" defaultValue={initial?.term_years} required />
        </Field>
        <Field label="Χάρη (έτη)" htmlFor={id("grace")}>
          <Input id={id("grace")} type="number" step="0.5" name="grace_years" defaultValue={initial?.grace_years ?? 0} />
        </Field>
      </div>
      <Field label="Πρώτος μήνας εξόφλησης" htmlFor={id("first")}>
        <Input id={id("first")} type="date" name="first_amortisation_month" defaultValue={initial?.first_amortisation_month ?? ""} />
      </Field>
      <Field label="Κατάσταση" hint={f.hint.loanState} htmlFor={id("state")}>
        <Select id={id("state")} name="state" defaultValue={initial?.state ?? "in_application"}>
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
            <Button type="button" variant="ghost" size="sm" className="max-md:min-w-11" aria-label="Αφαίρεση εκταμίευσης" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
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

      <Field label="Σημειώσεις" htmlFor={id("notes")}>
        <Textarea id={id("notes")} name="notes" defaultValue={initial?.notes ?? ""} rows={2} />
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
  const id = useIds();
  return (
    <>
      <Field label="Όνομα Σεναρίου" htmlFor={id("name")} required>
        <Input id={id("name")} name="name" defaultValue={initial?.name ?? "Βασικό"} required />
      </Field>
      <Field label="Σταθερός ετήσιος τζίρος (€, αν δεν υπάρχει ανάλυση εσόδων)" htmlFor={id("flat")}>
        <Input id={id("flat")} type="number" step="0.01" name="flat_annual_revenue" defaultValue={initial?.flat_annual_revenue ?? ""} />
      </Field>
      <div className={two}>
        <Field label="Ανάπτυξη εσόδων (%/έτος)" htmlFor={id("revenue-growth")}>
          <Input id={id("revenue-growth")} type="number" step="0.01" name="revenue_growth_pct_pct" defaultValue={pct(initial?.revenue_growth_pct, 0)} />
        </Field>
        <Field label="Ανάπτυξη opex (%/έτος)" hint={HINT.opex} htmlFor={id("opex-growth")}>
          <Input id={id("opex-growth")} type="number" step="0.01" name="opex_growth_pct_pct" defaultValue={pct(initial?.opex_growth_pct, 0)} />
        </Field>
      </div>
      <Field label="Η ανάπτυξη ξεκινά μετά το λειτουργικό έτος" htmlFor={id("growth-start")}>
        <Input
          id={id("growth-start")}
          type="number"
          min={0}
          name="growth_starts_after_operating_year"
          defaultValue={initial?.growth_starts_after_operating_year ?? 3}
        />
      </Field>
      <div className={two}>
        <Field label="Προεξοφλητικό επιτόκιο (%)" hint={HINT.discount} htmlFor={id("discount")}>
          <Input id={id("discount")} type="number" step="0.01" name="discount_rate_pct_pct" defaultValue={pct(initial?.discount_rate_pct, 9)} />
        </Field>
        <Field label="Ελάχιστο DSCR" hint={HINT.dscr} htmlFor={id("dscr")}>
          <Input id={id("dscr")} type="number" step="0.01" name="dscr_covenant_min" defaultValue={initial?.dscr_covenant_min ?? 1.2} />
        </Field>
      </div>
      <Field label="ADR σε σχέση με την ανάλυση (%)" hint={HINT.adr} htmlFor={id("adr")}>
        <Input
          id={id("adr")}
          type="number"
          step="1"
          min="1"
          name="adr_multiplier_pct"
          defaultValue={initial?.adr_multiplier != null ? Math.round(initial.adr_multiplier * 100) : 100}
        />
      </Field>
      <Field label="Σημειώσεις" htmlFor={id("notes")}>
        <Textarea id={id("notes")} name="notes" defaultValue={initial?.notes ?? ""} rows={2} />
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
  const id = useIds();
  const [kind, setKind] = useState<OpexLineKind>(initial?.kind ?? "fixed_annual");
  return (
    <>
      <Field label="Ετικέτα" htmlFor={id("label")} required>
        <Input id={id("label")} name="label" defaultValue={initial?.label} required />
      </Field>
      <Field label="Τύπος" htmlFor={id("kind")}>
        <Select id={id("kind")} name="kind" value={kind} onChange={(e) => setKind(e.target.value as OpexLineKind)}>
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
            <Field label="Θέσεις (headcount)" htmlFor={id("headcount")} required>
              <Input id={id("headcount")} type="number" step="0.01" name="headcount" defaultValue={initial?.headcount ?? ""} required />
            </Field>
            <Field label="Μηνιαίος μισθός (€)" htmlFor={id("wage")} required>
              <Input id={id("wage")} type="number" step="0.01" name="monthly_wage" defaultValue={initial?.monthly_wage ?? ""} required />
            </Field>
          </div>
          <div className={two}>
            <Field label="Μισθοί/έτος (π.χ. 14)" htmlFor={id("salaries")} required>
              <Input id={id("salaries")} type="number" step="0.5" name="salaries_per_year" defaultValue={initial?.salaries_per_year ?? 14} required />
            </Field>
            <Field label="Μήνες ενεργό" htmlFor={id("months")} required>
              <Input id={id("months")} type="number" min={1} max={12} name="months_active" defaultValue={initial?.months_active ?? 12} required />
            </Field>
          </div>
          <div className={two}>
            <Field label="Εργοδοτικές εισφορές (%)" htmlFor={id("contribution")}>
              <Input
                id={id("contribution")}
                type="number"
                step="0.01"
                name="employer_contribution_pct_pct"
                defaultValue={pct(initial?.employer_contribution_pct, 21.79)}
              />
            </Field>
            <Field label="Πριμ νυχτ./αργιών (%)" htmlFor={id("premium")}>
              <Input id={id("premium")} type="number" step="0.01" name="premium_pct_pct" defaultValue={pct(initial?.premium_pct, 0)} />
            </Field>
          </div>
        </>
      )}

      {kind === "pct_of_revenue" && (
        <Field label="Ποσοστό επί τζίρου (%)" htmlFor={id("pct")} required>
          <Input id={id("pct")} type="number" step="0.01" name="pct_of_revenue_pct" defaultValue={pct(initial?.pct_of_revenue, "")} required />
        </Field>
      )}

      {kind === "fixed_annual" && (
        <Field label="Ετήσιο ποσό (€)" htmlFor={id("annual")} required>
          <Input id={id("annual")} type="number" step="0.01" name="annual_amount" defaultValue={initial?.annual_amount ?? ""} required />
        </Field>
      )}

      <div className={two}>
        <Field label="Από λειτουργικό έτος" htmlFor={id("from")} required>
          <Input id={id("from")} type="number" min={1} name="from_operating_year" defaultValue={initial?.from_operating_year ?? 1} required />
        </Field>
        <Field label="Έως λειτουργικό έτος (προαιρετικό)" htmlFor={id("to")}>
          <Input id={id("to")} type="number" min={1} name="to_operating_year" defaultValue={initial?.to_operating_year ?? ""} />
        </Field>
      </div>
      <Field label="Σημείωση" htmlFor={id("note")}>
        <Input id={id("note")} name="note" defaultValue={initial?.note ?? ""} />
      </Field>
    </>
  );
}
