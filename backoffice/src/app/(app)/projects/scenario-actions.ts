"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { OpexLineKind } from "@/lib/domain/enums";

// Previously the revenue plan feeding a project's ΛΕΙΤΟΥΡΓΙΑ model
// (project_scenarios.revenue_plan_id) was set once at creation with no UI
// to see which plan was in use or switch it -- the project page just
// silently used whatever was linked.
export async function setScenarioRevenuePlan(projectId: string, scenarioId: string, formData: FormData) {
  const supabase = await createClient();
  const revenuePlanId = String(formData.get("revenue_plan_id") || "") || null;

  const { error } = await supabase
    .from("project_scenarios")
    .update({ revenue_plan_id: revenuePlanId })
    .eq("id", scenarioId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

// The rest of the scenario -- growth rates, discount rate, DSCR covenant,
// flat revenue fallback -- was previously not editable anywhere, not even
// via the AI chat (project_scenarios isn't in writeTools.ts's ALLOWLIST).
// Creates the base scenario on first save if the project doesn't have one
// yet, so a project with none can still get one instead of this whole
// editing surface being unreachable until a DB row exists.
export async function saveScenario(projectId: string, scenarioId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const fields = {
    name: String(formData.get("name") || "Βασικό"),
    flat_annual_revenue: formData.get("flat_annual_revenue") ? Number(formData.get("flat_annual_revenue")) : null,
    revenue_growth_pct: Number(formData.get("revenue_growth_pct_pct") ?? 0) / 100,
    opex_growth_pct: Number(formData.get("opex_growth_pct_pct") ?? 0) / 100,
    growth_starts_after_operating_year: Number(formData.get("growth_starts_after_operating_year") ?? 3),
    discount_rate_pct: Number(formData.get("discount_rate_pct_pct") ?? 9) / 100,
    dscr_covenant_min: Number(formData.get("dscr_covenant_min") ?? 1.2),
    notes: formString(formData, "notes"),
  };

  if (scenarioId) {
    const { error } = await supabase.from("project_scenarios").update(fields).eq("id", scenarioId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("project_scenarios")
      .insert({ ...fields, org_id: orgId, project_id: projectId, code: "base", is_base: true });
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}`);
}

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
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteOpexLine(projectId: string, lineId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("opex_lines").delete().eq("id", lineId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
