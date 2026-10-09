"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { addMonths, lastOfMonth, monthKeyOf, todayAthens } from "@/lib/dates";
import { action, UserError, type ActionResult } from "@/lib/actions";

// vat_periods stores only human facts (filed?, when, how much) -- the
// figures themselves come from v_vat_position, computed from the ledger.
//
// Filing a period locks it (0064): the VAT figures as they stand at that
// moment are snapshotted into locked_vat_income/expense and v_vat_position
// shows those from then on, so a backdated invoice entered later cannot
// silently rewrite what was submitted -- the difference rolls into the next
// open period instead. Un-filing releases the lock.

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function periodFigures(supabase: Supabase, orgId: string, periodStart: string) {
  const { data, error } = await supabase
    .from("v_vat_position")
    .select("vat_income, vat_expense, period_months, is_locked")
    .eq("org_id", orgId)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw error;
  const months = Number(data?.period_months ?? 1);
  return {
    vatIncome: Number(data?.vat_income ?? 0),
    vatExpense: Number(data?.vat_expense ?? 0),
    isLocked: Boolean(data?.is_locked),
    periodEnd: lastOfMonth(addMonths(monthKeyOf(periodStart), months - 1)),
  };
}

function lockFields(filed: boolean, figures: { vatIncome: number; vatExpense: number; isLocked: boolean }) {
  // Already locked figures come from the snapshot; re-filing keeps them.
  if (filed && figures.isLocked) return {};
  return filed
    ? { locked: true, locked_vat_income: figures.vatIncome, locked_vat_expense: figures.vatExpense }
    : { locked: false, locked_vat_income: null, locked_vat_expense: null };
}

export async function toggleVatFiled(periodStart: string, currentlyFiled: boolean): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const figures = await periodFigures(supabase, orgId, periodStart);

    const nowFiled = !currentlyFiled;
    const { error } = await supabase.from("vat_periods").upsert(
      {
        org_id: orgId,
        period_start: periodStart,
        period_end: figures.periodEnd,
        status: nowFiled ? "filed" : "pending",
        filed_on: nowFiled ? todayAthens() : null,
        ...lockFields(nowFiled, figures),
      },
      { onConflict: "org_id,period_start" },
    );
    if (error) throw error;
    revalidatePath("/reports/vat");
    revalidatePath("/reports/cash");
  });
}

export async function upsertVatPeriodFiling(periodStart: string, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const figures = await periodFigures(supabase, orgId, periodStart);

    const filed = formData.get("filed") === "on";
    const amountPaid = formString(formData, "amount_paid");
    if (amountPaid && !Number.isFinite(Number(amountPaid))) throw new UserError("Μη έγκυρο ποσό πληρωμής.");

    const { error } = await supabase.from("vat_periods").upsert(
      {
        org_id: orgId,
        period_start: periodStart,
        period_end: figures.periodEnd,
        status: filed ? "filed" : "pending",
        filed_on: filed ? todayAthens() : null,
        amount_paid: amountPaid ? Number(amountPaid) : null,
        paid_on: formString(formData, "paid_on"),
        reference: formString(formData, "reference"),
        ...lockFields(filed, figures),
      },
      { onConflict: "org_id,period_start" },
    );
    if (error) throw error;
    revalidatePath("/reports/vat");
    revalidatePath("/reports/cash");
  });
}
