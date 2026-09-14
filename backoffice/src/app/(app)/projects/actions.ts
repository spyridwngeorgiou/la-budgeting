"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { ProjectStatus, ProjectType, BusinessModel } from "@/lib/domain/enums";

function fieldsFromForm(formData: FormData) {
  return {
    code: String(formData.get("code")),
    display_name: String(formData.get("display_name")),
    project_type: (formString(formData, "project_type") as ProjectType) ?? null,
    status: (formString(formData, "status") as ProjectStatus) ?? "active",
    business_model: (formString(formData, "business_model") as BusinessModel) ?? null,
    start_date: formString(formData, "start_date"),
  };
}

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { error } = await supabase.from("projects").insert({
    ...fieldsFromForm(formData),
    org_id: orgId,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/projects");
}

export async function updateProject(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update(fieldsFromForm(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/projects");
}
