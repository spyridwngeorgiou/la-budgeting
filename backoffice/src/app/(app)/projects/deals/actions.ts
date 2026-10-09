"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { addDays, isIsoDate, todayAthens } from "@/lib/dates";
import { deriveFromNet } from "@/lib/finance/money";
import { el } from "@/lib/i18n/el";
import { DEAL_STAGE, type DealStage } from "@/lib/domain/enums";

// Brokerage deals (0065): a list, not a CRM. Open deals feed the cash
// forecast weighted by stage (deal_stage_probability); «Κλείσιμο» turns the
// commission into a pending receivable, after which the ledger carries it.

const COMMISSION_VAT_RATE = 0.24;
const RECEIVABLE_TERMS_DAYS = 30;

function revalidate() {
  revalidatePath("/projects/deals");
  revalidatePath("/reports/cash");
  revalidatePath("/dashboard");
}

function fieldsFromForm(formData: FormData) {
  const t = el.deals;
  const property = (formString(formData, "property_label") ?? "").trim();
  if (!property) throw new UserError(`${t.property}: υποχρεωτικό.`);
  const price = Number(formData.get("price"));
  if (!Number.isFinite(price) || price < 0) throw new UserError(t.invalidPrice);
  const pct = Number(formData.get("commission_pct") ?? 2);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new UserError(t.invalidPct);
  const overrideText = formString(formData, "commission_amount");
  const override = overrideText ? Number(overrideText) : null;
  if (override !== null && (!Number.isFinite(override) || override < 0)) throw new UserError(t.invalidPrice);
  const stage = formString(formData, "stage") ?? "lead";
  if (!(DEAL_STAGE as readonly string[]).includes(stage) || stage === "closed") {
    throw new UserError("Μη έγκυρο στάδιο· το «Έκλεισε» γίνεται με το κουμπί Κλείσιμο.");
  }
  const expected = formString(formData, "expected_close_date");
  if (expected && !isIsoDate(expected)) throw new UserError("Μη έγκυρη ημερομηνία.");
  return {
    property_label: property,
    price,
    commission_pct: pct / 100,
    commission_amount: override,
    stage: stage as DealStage,
    expected_close_date: expected,
    client_contact_id: formString(formData, "client_contact_id"),
    project_id: formString(formData, "project_id"),
    notes: formString(formData, "notes"),
  };
}

export async function saveDeal(id: string | null, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const fields = fieldsFromForm(formData);
    if (id) {
      const { data: current } = await supabase.from("brokerage_deals").select("stage").eq("id", id).maybeSingle();
      if (current?.stage === "closed") throw new UserError(el.deals.alreadyClosed);
    }
    const { error } = id
      ? await supabase.from("brokerage_deals").update(fields).eq("id", id).eq("org_id", orgId)
      : await supabase.from("brokerage_deals").insert({ ...fields, org_id: orgId });
    if (error) throw error;
    revalidate();
  });
}

// Closing: the commission (+ 24% VAT) becomes a pending receivable from the
// client, due in 30 days; the deal is marked closed and linked to it.
export async function closeDeal(id: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { data: deal, error } = await supabase
      .from("brokerage_deals")
      .select("id, stage, property_label, price, commission_pct, commission_amount, client_contact_id, project_id")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw error;
    if (!deal) throw new UserError("Η συμφωνία δεν βρέθηκε.");
    if (deal.stage === "closed") throw new UserError(el.deals.alreadyClosed);

    const commission = deal.commission_amount ?? Math.round(Number(deal.price) * Number(deal.commission_pct) * 100) / 100;
    if (commission <= 0) throw new UserError("Η προμήθεια είναι μηδενική· συμπληρώστε ποσοστό ή ποσό.");
    const money = deriveFromNet(commission, COMMISSION_VAT_RATE);
    const today = todayAthens();

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        org_id: orgId,
        tx_date: today,
        due_date: addDays(today, RECEIVABLE_TERMS_DAYS),
        direction: "income",
        scope: "business",
        status: "pending",
        origin: "manual",
        contact_id: deal.client_contact_id,
        project_id: deal.project_id,
        gross_amount: money.gross,
        net_amount: money.net,
        vat_amount: money.vat,
        vat_rate: COMMISSION_VAT_RATE,
        has_invoice: true,
        description: `Προμήθεια μεσιτείας — ${deal.property_label}`,
      })
      .select("id")
      .single();
    if (txErr) throw txErr;

    const { error: updErr } = await supabase
      .from("brokerage_deals")
      .update({ stage: "closed", closed_on: today, transaction_id: tx.id })
      .eq("id", id);
    if (updErr) {
      // never leave a receivable for a deal that still looks open (it would
      // be counted twice in the forecast)
      await supabase.from("transactions").delete().eq("id", tx.id);
      throw updErr;
    }
    revalidate();
    revalidatePath("/transactions");
  });
}

export async function deleteDeal(id: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = await supabase.from("brokerage_deals").delete().eq("id", id).eq("org_id", orgId);
    if (error) throw error;
    revalidate();
  });
}
