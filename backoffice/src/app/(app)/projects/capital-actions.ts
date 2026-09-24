"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { CapitalSourceKind } from "@/lib/domain/enums";

function fieldsFromForm(formData: FormData, projectId: string) {
  return {
    project_id: projectId,
    kind: String(formData.get("kind")) as CapitalSourceKind,
    contributor: formString(formData, "contributor"),
    amount: Number(formData.get("amount")),
    contributed_on: String(formData.get("contributed_on")),
    notes: formString(formData, "notes"),
  };
}

export async function saveCapitalSource(projectId: string, sourceId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const fields = fieldsFromForm(formData, projectId);

  if (sourceId) {
    const { error } = await supabase.from("project_capital_sources").update(fields).eq("id", sourceId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("project_capital_sources").insert({ ...fields, org_id: orgId });
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteCapitalSource(projectId: string, sourceId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("project_capital_sources").delete().eq("id", sourceId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
