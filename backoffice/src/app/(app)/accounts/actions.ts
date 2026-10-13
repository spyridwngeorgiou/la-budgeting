"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { AccountKind, OwnerScope } from "@/lib/domain/enums";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { isValidIban } from "@/lib/ingest/text";
import { el } from "@/lib/i18n/el";

// The account's fields from the form, validated the same way for create
// and edit (createAccount / updateAccount).
function accountFields(formData: FormData) {
  const iban = formString(formData, "iban")?.replace(/\s+/g, "").toUpperCase() ?? null;
  if (iban && !isValidIban(iban)) throw new UserError(el.account.invalidIban);
  const accountNumber = formString(formData, "account_number")?.replace(/[\s-]/g, "") ?? null;
  if (accountNumber && !/^[0-9]{6,34}$/.test(accountNumber)) throw new UserError(el.account.invalidAccountNumber);
  return {
    iban,
    account_number: accountNumber,
    name: String(formData.get("name")),
    kind: (formString(formData, "kind") as AccountKind) ?? "bank",
    owner_scope: String(formData.get("owner_scope")) as OwnerScope,
    is_liquid: formData.get("is_liquid") === "on",
    opening_balance: Number(formData.get("opening_balance") ?? 0),
    opening_balance_date: String(formData.get("opening_balance_date")),
  };
}

export async function createAccount(formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = await supabase.from("accounts").insert({ ...accountFields(formData), org_id: orgId });
    if (error) throw error;
    revalidatePath("/accounts");
  });
}

// Same fields and checks as createAccount. The id is a plain argument (the
// form calls updateAccount(id, formData)), never a bound one.
export async function updateAccount(accountId: string, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { data, error } = await supabase
      .from("accounts")
      .update(accountFields(formData))
      .eq("org_id", orgId)
      .eq("id", accountId)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new UserError("Ο λογαριασμός δεν βρέθηκε.");
    // The list and the account's own page.
    revalidatePath("/accounts", "layout");
  });
}

// Full bank-statement reconciliation is a deliberately deferred, much
// bigger build -- this is the cheap 80%: once a month, type in the real
// closing balance, see the drift against what the ledger computes.
// computed_balance is read fresh from v_account_balances and stored as a
// snapshot on the row, not recomputed later, so a backdated transaction
// entered afterward can't silently rewrite a drift someone already saw.
export async function assertAccountBalance(accountId: string, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);

    const assertedBalance = Number(formData.get("asserted_balance"));
    const asOfDate = String(formData.get("as_of_date"));
    const periodStart = formString(formData, "period_start");
    if (periodStart && periodStart >= asOfDate) throw new UserError("Η αρχή του ελέγχου πρέπει να είναι πριν την ημερομηνία του υπολοίπου.");
    if (!Number.isFinite(assertedBalance)) throw new UserError("Μη έγκυρο υπόλοιπο.");

    // Snapshot the balance AS OF the count's own date, not today's -- a count
    // entered a few days late must compare against what the ledger said then.
    const { data: computedBalance, error: balanceError } = await supabase.rpc("account_balance_as_of", {
      p_account: accountId,
      p_date: asOfDate,
    });
    if (balanceError || computedBalance == null) throw balanceError ?? new UserError("Ο λογαριασμός δεν βρέθηκε.");

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
        period_start: periodStart,
        created_by: session?.user.id,
      },
      { onConflict: "account_id,as_of_date" },
    );
    if (error) throw error;
    revalidatePath("/accounts");
  });
}
