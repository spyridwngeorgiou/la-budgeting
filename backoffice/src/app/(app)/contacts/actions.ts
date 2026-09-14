"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { isValidAfm } from "@/lib/finance/money";

function fieldsFromForm(formData: FormData) {
  const afm = formString(formData, "afm");
  if (afm && !isValidAfm(afm)) {
    throw new Error("Μη έγκυρο ΑΦΜ (δεν περνάει τον έλεγχο ψηφίου ελέγχου).");
  }

  return {
    name: String(formData.get("name")),
    afm,
    phone: formString(formData, "phone"),
    email: formString(formData, "email"),
  };
}

export async function createContact(formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { error } = await supabase.from("contacts").insert({
    ...fieldsFromForm(formData),
    org_id: orgId,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
}

export async function updateContact(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").update(fieldsFromForm(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
}
