"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { TxDirection, TxScope, PlanFrequency, VatRate } from "@/lib/domain/enums";

export async function createInstallmentPlan(formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const hasVat = formData.get("has_invoice") === "on";
  const vatRate = hasVat ? (Number(formData.get("vat_rate") ?? 0) as VatRate) : null;
  const amountPerInstallment = Number(formData.get("amount_per_installment"));
  const vatPerInstallment = vatRate ? Math.round(amountPerInstallment * vatRate * 100) / 100 : 0;

  const { data: plan, error } = await supabase
    .from("installment_plans")
    .insert({
      org_id: orgId,
      label: String(formData.get("label")),
      direction: String(formData.get("direction")) as TxDirection,
      scope: String(formData.get("scope") ?? "business") as TxScope,
      contact_id: formString(formData, "contact_id"),
      project_id: formString(formData, "project_id"),
      category_id: formString(formData, "category_id"),
      account_id: formString(formData, "account_id"),
      amount_per_installment: amountPerInstallment,
      vat_rate: vatRate,
      vat_per_installment: vatPerInstallment,
      frequency: String(formData.get("frequency") ?? "monthly") as PlanFrequency,
      first_due_date: String(formData.get("first_due_date")),
      installment_count: formString(formData, "installment_count")
        ? Number(formData.get("installment_count"))
        : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const { error: genError } = await supabase.rpc("regenerate_plan", { p_plan_id: plan.id });
  if (genError) throw new Error(genError.message);

  revalidatePath("/installments");
}

export async function regeneratePlan(planId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_plan", { p_plan_id: planId });
  if (error) throw new Error(error.message);
  revalidatePath("/installments");
}

export async function markInstallmentPaid(transactionId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update({ status: "paid", paid_on: new Date().toISOString().slice(0, 10) })
    .eq("id", transactionId);

  if (error) throw new Error(error.message);
  revalidatePath("/installments");
}
