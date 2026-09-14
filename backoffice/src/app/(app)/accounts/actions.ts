"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { AccountKind, OwnerScope } from "@/lib/domain/enums";

export async function createAccount(formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { error } = await supabase.from("accounts").insert({
    org_id: orgId,
    name: String(formData.get("name")),
    kind: (formString(formData, "kind") as AccountKind) ?? "bank",
    owner_scope: String(formData.get("owner_scope")) as OwnerScope,
    is_liquid: formData.get("is_liquid") === "on",
    opening_balance: Number(formData.get("opening_balance") ?? 0),
    opening_balance_date: String(formData.get("opening_balance_date")),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/accounts");
}
