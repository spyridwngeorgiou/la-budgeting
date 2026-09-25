"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { Database } from "@/lib/db/types";

type UtilityKind = Database["public"]["Enums"]["utility_kind"];

export async function saveUtility(projectId: string, utilityId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const fields = {
    project_id: projectId,
    kind: (formString(formData, "kind") ?? "electricity") as UtilityKind,
    provider: formString(formData, "provider"),
    supply_number: formString(formData, "supply_number"),
    contract_account: formString(formData, "contract_account"),
    rf_code: formString(formData, "rf_code"),
    meter_number: formString(formData, "meter_number"),
    notes: formString(formData, "notes"),
  };

  const { error } = utilityId
    ? await supabase.from("property_utilities").update(fields).eq("id", utilityId)
    : await supabase.from("property_utilities").insert({ ...fields, org_id: orgId });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/properties");
}

export async function deleteUtility(projectId: string, utilityId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("property_utilities").delete().eq("id", utilityId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/properties");
}
