"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { isValidAfm } from "@/lib/finance/money";

export async function updateOwnAfm(formData: FormData) {
  const afm = String(formData.get("own_afm"));
  if (!isValidAfm(afm)) {
    throw new Error("Μη έγκυρο ΑΦΜ (δεν περνάει τον έλεγχο ψηφίου ελέγχου).");
  }

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { error } = await supabase
    .from("orgs")
    .update({ name: String(formData.get("name")), own_afm: afm })
    .eq("id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
