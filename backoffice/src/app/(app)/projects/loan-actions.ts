"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { LiabilityState } from "@/lib/domain/enums";

// Loans were previously editable only through the Kansha AI chat's
// propose-and-approve flow (src/lib/ai/writeTools.ts ALLOWLIST) -- useful
// for a quick AI-driven edit, but there was no direct form, so entering a
// new loan tranche meant either asking the AI or a raw DB edit. Same
// project_id-scoped shape as ALLOWLIST's "loans" entry.
function fieldsFromForm(formData: FormData, projectId: string) {
  return {
    project_id: projectId,
    label: String(formData.get("label")),
    principal: Number(formData.get("principal")),
    interest_rate: Number(formData.get("interest_rate_pct")) / 100,
    term_years: Number(formData.get("term_years")),
    grace_years: Number(formData.get("grace_years") ?? 0),
    first_amortisation_month: formString(formData, "first_amortisation_month"),
    state: (formString(formData, "state") as LiabilityState) ?? "in_application",
    notes: formString(formData, "notes"),
  };
}

export async function saveLoan(projectId: string, loanId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const fields = fieldsFromForm(formData, projectId);

  if (loanId) {
    const { error } = await supabase.from("loans").update(fields).eq("id", loanId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("loans").insert({ ...fields, org_id: orgId });
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteLoan(projectId: string, loanId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("loans").delete().eq("id", loanId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
