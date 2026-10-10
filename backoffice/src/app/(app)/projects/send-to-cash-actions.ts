"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { addMonths, currentMonthKey, firstOfMonth } from "@/lib/dates";
import { computeScenarioFromInputs, loadScenarioInputs } from "@/lib/finance/projectModel";
import { el } from "@/lib/i18n/el";

// «Στείλε στο ταμείο»: a project scenario's monthly revenue and operating
// costs become expected_income rows (scenario_id set), which the cash
// forecast (0066) already reads, weighted by probability. Rent and debt
// service are NOT sent: they are in the ledger already, through the lease
// and loan schedules (0065), and sending them would count them twice.
// Re-sending replaces the scenario's open rows; nothing else is touched.

const HORIZONS = [12, 24, 36] as const;

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
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
