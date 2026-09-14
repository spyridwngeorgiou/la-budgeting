"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";

// vat_periods stores only human facts (filed?, when, how much) -- the
// figures themselves come from v_vat_position, computed from the ledger.
export async function toggleVatFiled(periodStart: string, currentlyFiled: boolean) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  periodEnd.setDate(0);

  const nowFiled = !currentlyFiled;
  const { error } = await supabase.from("vat_periods").upsert(
    {
      org_id: orgId,
      period_start: periodStart,
      period_end: periodEnd.toISOString().slice(0, 10),
      status: nowFiled ? "filed" : "pending",
      filed_on: nowFiled ? new Date().toISOString().slice(0, 10) : null,
    },
    { onConflict: "org_id,period_start" },
  );

  if (error) throw new Error(error.message);
  revalidatePath("/vat");
}

export async function upsertVatPeriodFiling(periodStart: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const filed = formData.get("filed") === "on";
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  periodEnd.setDate(0);

  const { error } = await supabase.from("vat_periods").upsert(
    {
      org_id: orgId,
      period_start: periodStart,
      period_end: periodEnd.toISOString().slice(0, 10),
      status: filed ? "filed" : "pending",
      filed_on: filed ? new Date().toISOString().slice(0, 10) : null,
      amount_paid: formString(formData, "amount_paid") ? Number(formData.get("amount_paid")) : null,
      paid_on: formString(formData, "paid_on"),
      reference: formString(formData, "reference"),
    },
    { onConflict: "org_id,period_start" },
  );

  if (error) throw new Error(error.message);
  revalidatePath("/vat");
}
