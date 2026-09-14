"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { isValidAfm } from "@/lib/finance/money";

export async function changePassword(formData: FormData) {
  const newPassword = String(formData.get("new_password"));
  const confirm = String(formData.get("confirm_password"));

  if (newPassword.length < 8) {
    throw new Error("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.");
  }
  if (newPassword !== confirm) {
    throw new Error("Οι κωδικοί δεν ταιριάζουν.");
  }

  const supabase = await createClient();
  // updateUser acts on the currently authenticated session -- no admin
  // rights or anyone else's password involved, just "change my own".
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

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
