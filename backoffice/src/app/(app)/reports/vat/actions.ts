"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { lastOfMonth, monthKeyOf, todayAthens } from "@/lib/dates";

// vat_periods stores only human facts (filed?, when, how much) -- the
// figures themselves come from v_vat_position, computed from the ledger.
export async function toggleVatFiled(periodStart: string, currentlyFiled: boolean) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const periodEnd = lastOfMonth(monthKeyOf(periodStart));

  const nowFiled = !currentlyFiled;
  const { error } = await supabase.from("vat_periods").upsert(
    {
      org_id: orgId,
      period_start: periodStart,
      period_end: periodEnd,
      status: nowFiled ? "filed" : "pending",
      filed_on: nowFiled ? todayAthens() : null,
    },
    { onConflict: "org_id,period_start" },
  );

  if (error) throw new Error(error.message);
  revalidatePath("/reports/vat");
}

export async function upsertVatPeriodFiling(periodStart: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const filed = formData.get("filed") === "on";
  const periodEnd = lastOfMonth(monthKeyOf(periodStart));

  const { error } = await supabase.from("vat_periods").upsert(
    {
      org_id: orgId,
      period_start: periodStart,
      period_end: periodEnd,
      status: filed ? "filed" : "pending",
      filed_on: filed ? todayAthens() : null,
      amount_paid: formString(formData, "amount_paid") ? Number(formData.get("amount_paid")) : null,
      paid_on: formString(formData, "paid_on"),
      reference: formString(formData, "reference"),
    },
    { onConflict: "org_id,period_start" },
  );

  if (error) throw new Error(error.message);
  revalidatePath("/reports/vat");
}
