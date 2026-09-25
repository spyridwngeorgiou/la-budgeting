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

// Full bank-statement reconciliation is a deliberately deferred, much
// bigger build -- this is the cheap 80%: once a month, type in the real
// closing balance, see the drift against what the ledger computes.
// computed_balance is read fresh from v_account_balances and stored as a
// snapshot on the row, not recomputed later, so a backdated transaction
// entered afterward can't silently rewrite a drift someone already saw.
export async function assertAccountBalance(accountId: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const assertedBalance = Number(formData.get("asserted_balance"));
  const asOfDate = String(formData.get("as_of_date"));
  if (!Number.isFinite(assertedBalance)) throw new Error("Μη έγκυρο υπόλοιπο.");

  // Snapshot the balance AS OF the count's own date, not today's -- a count
  // entered a few days late must compare against what the ledger said then.
  const { data: computedBalance, error: balanceError } = await supabase.rpc("account_balance_as_of", {
    p_account: accountId,
    p_date: asOfDate,
  });
  if (balanceError || computedBalance == null) throw new Error(balanceError?.message ?? "Ο λογαριασμός δεν βρέθηκε.");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { error } = await supabase.from("account_balance_assertions").upsert(
    {
      org_id: orgId,
      account_id: accountId,
      as_of_date: asOfDate,
      asserted_balance: assertedBalance,
      computed_balance: Number(computedBalance),
      created_by: session?.user.id,
    },
    { onConflict: "account_id,as_of_date" },
  );
  if (error) throw new Error(error.message);
  revalidatePath("/accounts");
}
