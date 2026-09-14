"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import type { BudgetLineCode } from "@/lib/domain/enums";

const LINES: BudgetLineCode[] = [
  "acquisition",
  "studies_permits_legal",
  "construction_equipment",
  "other",
];

// Budgets are versioned: saving always creates a new current version rather
// than overwriting the old one in place (the workbook has no history at
// all -- a revision just clobbers last month's numbers).
export async function saveProjectBudget(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { data: existing } = await supabase
    .from("project_budgets")
    .select("id, version")
    .eq("project_id", projectId)
    .eq("is_current", true)
    .maybeSingle();

  if (existing) {
    await supabase.from("project_budgets").update({ is_current: false }).eq("id", existing.id);
  }

  const { data: budget, error } = await supabase
    .from("project_budgets")
    .insert({
      org_id: orgId,
      project_id: projectId,
      version: (existing?.version ?? 0) + 1,
      is_current: true,
      contingency_pct: Number(formData.get("contingency_pct") ?? 0),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const lines = LINES.map((line) => ({
    org_id: orgId,
    budget_id: budget.id,
    line_code: line,
    amount: Number(formData.get(`line_${line}`) ?? 0),
  }));

  const { error: linesError } = await supabase.from("budget_lines").insert(lines);
  if (linesError) throw new Error(linesError.message);

  revalidatePath(`/projects/${projectId}`);
}
