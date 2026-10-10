"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { addMonths, currentMonthKey, firstOfMonth } from "@/lib/dates";
import { computeScenarioFromInputs, loadScenarioInputs } from "@/lib/finance/projectModel";
import type { OpexLineKind } from "@/lib/domain/enums";
import { el } from "@/lib/i18n/el";
import { projects as t2 } from "@/lib/i18n/v2/projects";
import { planNewScenario } from "@/features/projects/scenarioCode";
import { revalidateProject } from "../revalidate";

// Σενάρια: a project's scenarios, their opex lines, which one is the base,
// and «Στείλε στο ταμείο». One of the four action files of the project page
// (actions, [id]/finance-actions, [id]/scenario-actions,
// [id]/partner-actions); scenario-actions and send-to-cash-actions were
// merged here in Φ4.

type Supabase = Awaited<ReturnType<typeof createClient>>;

// ── Scenarios ─────────────────────────────────────────────────────────────────

// Previously the revenue plan feeding a project's ΛΕΙΤΟΥΡΓΙΑ model
// (project_scenarios.revenue_plan_id) was set once at creation with no UI
// to see which plan was in use or switch it.
export async function setScenarioRevenuePlan(projectId: string, scenarioId: string, formData: FormData) {
  const supabase = await createClient();
  const revenuePlanId = String(formData.get("revenue_plan_id") || "") || null;

  const { error } = await supabase
    .from("project_scenarios")
    .update({ revenue_plan_id: revenuePlanId })
    .eq("id", scenarioId);
  if (error) throw new Error(error.message);
  revalidateProject(projectId);
}

function scenarioFieldsFromForm(formData: FormData) {
  return {
    name: String(formData.get("name") || "Βασικό"),
    flat_annual_revenue: formData.get("flat_annual_revenue") ? Number(formData.get("flat_annual_revenue")) : null,
    revenue_growth_pct: Number(formData.get("revenue_growth_pct_pct") ?? 0) / 100,
    opex_growth_pct: Number(formData.get("opex_growth_pct_pct") ?? 0) / 100,
    growth_starts_after_operating_year: Number(formData.get("growth_starts_after_operating_year") ?? 3),
    discount_rate_pct: Number(formData.get("discount_rate_pct_pct") ?? 9) / 100,
    dscr_covenant_min: Number(formData.get("dscr_covenant_min") ?? 1.2),
    adr_multiplier: Math.max(0.01, Number(formData.get("adr_multiplier_pct") ?? 100) / 100 || 1),
    notes: formString(formData, "notes"),
  };
}

// Before Φ4 every insert was code 'base' with is_base true, so a second
// scenario hit unique (org_id, project_id, code) and the one-base index:
// a project could only ever have one. planNewScenario() picks a free code
// and makes the new scenario the base only when the project has none.
async function insertScenario(
  supabase: Supabase,
  orgId: string,
  projectId: string,
  fields: ReturnType<typeof scenarioFieldsFromForm>,
): Promise<string> {
  const { data: existing, error: readError } = await supabase
    .from("project_scenarios")
    .select("code, is_base, sort_order")
    .eq("project_id", projectId);
  if (readError) throw readError;
  const next = planNewScenario(existing ?? []);
  const { data, error } = await supabase
    .from("project_scenarios")
    .insert({ ...fields, org_id: orgId, project_id: projectId, ...next })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// The scenario's assumptions -- growth rates, discount rate, DSCR covenant,
// flat revenue fallback. Without an id it creates one (the v1 page's
// «+ Σενάριο Λειτουργίας»), the same way createScenario does.
export async function saveScenario(projectId: string, scenarioId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const fields = scenarioFieldsFromForm(formData);

  if (scenarioId) {
    const { error } = await supabase.from("project_scenarios").update(fields).eq("id", scenarioId);
    if (error) throw new Error(error.message);
  } else {
    await insertScenario(supabase, orgId, projectId, fields);
  }
  revalidateProject(projectId);
}

// «+ Νέο σενάριο» (Σενάρια tab): any number per project.
export async function createScenario(projectId: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const id = await insertScenario(supabase, orgId, projectId, scenarioFieldsFromForm(formData));
    revalidateProject(projectId);
    return { id };
  });
}

// «Ορισμός ως βάση»: one database call (0089) clears the old base and sets
// this one, so the project never has two bases, or none after a failure.
export async function setBaseScenario(projectId: string, scenarioId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_base_scenario", { p_scenario: scenarioId });
    if (error) throw error;
    revalidateProject(projectId);
  });
}

// An alternative scenario can be deleted; the base stays until another one
// is made the base.
export async function deleteScenario(projectId: string, scenarioId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("project_scenarios").select("is_base").eq("id", scenarioId).maybeSingle();
    if (error) throw error;
    if (data?.is_base) throw new UserError(t2.scenarios.cannotDeleteBase);
    const { error: delError } = await supabase.from("project_scenarios").delete().eq("id", scenarioId);
    if (delError) throw delError;
    revalidateProject(projectId);
  });
}

// ── Opex lines ────────────────────────────────────────────────────────────────

function pickOpexFields(formData: FormData) {
  const kind = String(formData.get("kind")) as OpexLineKind;
  return {
    kind,
    label: String(formData.get("label")),
    from_operating_year: Number(formData.get("from_operating_year") ?? 1),
    to_operating_year: formData.get("to_operating_year") ? Number(formData.get("to_operating_year")) : null,
    note: formString(formData, "note"),
    headcount: kind === "payroll" ? Number(formData.get("headcount")) : null,
    monthly_wage: kind === "payroll" ? Number(formData.get("monthly_wage")) : null,
    salaries_per_year: kind === "payroll" ? Number(formData.get("salaries_per_year")) : null,
    employer_contribution_pct: kind === "payroll" ? Number(formData.get("employer_contribution_pct_pct") ?? 0) / 100 : null,
    premium_pct: kind === "payroll" ? Number(formData.get("premium_pct_pct") ?? 0) / 100 : null,
    months_active: kind === "payroll" ? Number(formData.get("months_active") ?? 12) : null,
    pct_of_revenue: kind === "pct_of_revenue" ? Number(formData.get("pct_of_revenue_pct")) / 100 : null,
    annual_amount: kind === "fixed_annual" ? Number(formData.get("annual_amount")) : null,
  };
}

export async function saveOpexLine(projectId: string, scenarioId: string, lineId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const fields = pickOpexFields(formData);

  if (lineId) {
    const { error } = await supabase.from("opex_lines").update(fields).eq("id", lineId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("opex_lines").insert({ ...fields, org_id: orgId, scenario_id: scenarioId });
    if (error) throw new Error(error.message);
  }
  revalidateProject(projectId);
}

export async function deleteOpexLine(projectId: string, lineId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("opex_lines").delete().eq("id", lineId);
  if (error) throw new Error(error.message);
  revalidateProject(projectId);
}

// ── «Στείλε στο ταμείο» ───────────────────────────────────────────────────────

// «Στείλε στο ταμείο»: a project scenario's monthly revenue and operating
// costs become expected_income rows (scenario_id set), which the cash
// forecast (0066) already reads, weighted by probability. Rent and debt
// service are NOT sent: they are in the ledger already, through the lease
// and loan schedules (0065), and sending them would count them twice.
// Re-sending replaces the scenario's open rows; nothing else is touched.

const HORIZONS = [12, 24, 36] as const;

function revalidate(projectId: string) {
  revalidateProject(projectId);
  revalidatePath("/reports/cash");
  revalidatePath("/dashboard");
}

export async function sendScenarioToCash(
  projectId: string,
  scenarioId: string,
  formData: FormData,
): Promise<ActionResult<{ written: number }>> {
  return action(async () => {
    const t = el.sendToCash;
    const months = Number(formData.get("months") ?? 24);
    if (!(HORIZONS as readonly number[]).includes(months)) throw new UserError(t.invalidHorizon);
    const pct = Number(formData.get("probability_pct") ?? 80);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new UserError(t.invalidProbability);

    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const inputs = await loadScenarioInputs(supabase, projectId);
    const scenario = inputs?.scenarios.find((s) => s.id === scenarioId);
    if (!inputs || !scenario) throw new UserError(t.notFound);
    const result = computeScenarioFromInputs(inputs, scenario);
    if (!result.cashflow) throw new UserError(t.noCashflow);

    const from = firstOfMonth(currentMonthKey());
    const to = firstOfMonth(addMonths(currentMonthKey(), months - 1));
    const base = {
      org_id: orgId,
      project_id: projectId,
      scenario_id: scenarioId,
      business_line: inputs.project.business_line,
      owner_scope: "corporate" as const,
      notes: t.rowNote,
    };
    const rows = result.cashflow.months
      .filter((m) => m.month >= from && m.month <= to)
      .flatMap((m) => [
        ...(m.revenue > 0
          ? [{ ...base, source: `${scenario.name} · ${t.revenue}`, direction: "income" as const, amount: m.revenue,
               expected_month: m.month, probability: pct / 100, certainty: pct >= 100 ? ("certain" as const) : ("probable" as const) }]
          : []),
        ...(m.opex > 0
          ? [{ ...base, source: `${scenario.name} · ${t.opex}`, direction: "expense" as const, amount: m.opex,
               expected_month: m.month, probability: 1, certainty: "certain" as const }]
          : []),
      ]);
    if (rows.length === 0) throw new UserError(t.nothingInHorizon);

    const { error: delError } = await supabase
      .from("expected_income")
      .delete()
      .eq("org_id", orgId)
      .eq("scenario_id", scenarioId)
      .eq("status", "expected");
    if (delError) throw delError;
    const { error } = await supabase.from("expected_income").insert(rows);
    if (error) throw error;
    revalidate(projectId);
    return { written: rows.length };
  });
}

export async function removeScenarioFromCash(projectId: string, scenarioId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = await supabase
      .from("expected_income")
      .delete()
      .eq("org_id", orgId)
      .eq("scenario_id", scenarioId)
      .eq("status", "expected");
    if (error) throw error;
    revalidate(projectId);
  });
}
