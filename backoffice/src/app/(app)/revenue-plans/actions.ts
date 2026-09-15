"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { aiEnabled, logAiUsage } from "@/lib/ai/client";
import { extractRevenuePlan } from "@/lib/ai/revenuePlanExtract";

export async function createRevenuePlan(formData: FormData) {
  const supabase = await createClient();
  const [orgId, {
    data: { session },
  }] = await Promise.all([getCurrentOrgId(supabase), supabase.auth.getSession()]);

  const { data, error } = await supabase
    .from("revenue_plans")
    .insert({
      org_id: orgId,
      name: String(formData.get("name")),
      start_year: Number(formData.get("start_year")),
      years: Number(formData.get("years") ?? 3),
      project_id: formString(formData, "project_id"),
      created_by: session?.user.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/revenue-plans");
  redirect(`/revenue-plans/${data.id}`);
}

// The page's own "type it, get the analysis" entry point -- reuses exactly
// the create_revenue_plan tool's logic (extract -> insert plan -> insert
// room types -> insert assumptions), just invoked directly from a form
// instead of through the chat tool-loop. Writes immediately, same reasoning
// as the chat tool: a brand-new standalone analysis, not a mutation of real
// financial data, fully editable/deletable afterward.
export async function createRevenuePlanFromText(formData: FormData) {
  if (!aiEnabled()) {
    throw new Error("Ο βοηθός AI δεν είναι ενεργοποιημένος. Ορίστε ANTHROPIC_API_KEY και AI_ENABLED=true.");
  }
  const text = String(formData.get("text") ?? "").trim();
  if (!text) throw new Error("Περιγράψτε την ανάλυση που θέλετε (τύποι δωματίων, τιμές, πληρότητα).");

  const supabase = await createClient();
  const [orgId, {
    data: { session },
  }] = await Promise.all([getCurrentOrgId(supabase), supabase.auth.getSession()]);

  const { extraction, usage } = await extractRevenuePlan(text, new Date().getFullYear());

  const years = Math.max(1, ...extraction.room_types.flatMap((rt) => rt.assumptions.map((a) => a.year_number)));

  const { data: plan, error: planError } = await supabase
    .from("revenue_plans")
    .insert({
      org_id: orgId,
      name: extraction.name,
      start_year: extraction.start_year,
      years,
      notes: extraction.assumptions_note,
      created_by: session?.user.id,
    })
    .select("id")
    .single();
  if (planError) throw new Error(planError.message);

  for (const rt of extraction.room_types) {
    const { data: roomType, error: rtError } = await supabase
      .from("revenue_plan_room_types")
      .insert({ org_id: orgId, revenue_plan_id: plan.id, name: rt.name, unit_count: rt.unit_count })
      .select("id")
      .single();
    if (rtError) throw new Error(rtError.message);

    if (rt.assumptions.length > 0) {
      const { error: aError } = await supabase.from("revenue_plan_assumptions").insert(
        rt.assumptions.map((a) => ({
          org_id: orgId,
          room_type_id: roomType.id,
          year_number: a.year_number,
          month_number: a.month_number,
          occupancy_pct: a.occupancy_pct,
          adr: a.adr,
        })),
      );
      if (aError) throw new Error(aError.message);
    }
  }

  await logAiUsage(supabase, {
    orgId,
    userId: session?.user.id ?? null,
    feature: "revenue_plan_creation",
    model: "claude-opus-5",
    inputTokens: usage.inputTokens,
    cacheReadTokens: 0,
    outputTokens: usage.outputTokens,
    requestId: usage.requestId,
  });

  revalidatePath("/revenue-plans");
  redirect(`/revenue-plans/${plan.id}`);
}

export async function deleteRevenuePlan(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("revenue_plans").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/revenue-plans");
  redirect("/revenue-plans");
}

export async function addRoomType(planId: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { error } = await supabase.from("revenue_plan_room_types").insert({
    org_id: orgId,
    revenue_plan_id: planId,
    name: String(formData.get("name")),
    unit_count: Number(formData.get("unit_count")),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/revenue-plans/${planId}`);
}

export async function deleteRoomType(planId: string, roomTypeId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("revenue_plan_room_types").delete().eq("id", roomTypeId);
  if (error) throw new Error(error.message);
  revalidatePath(`/revenue-plans/${planId}`);
}

// One save per (room type, year) -- 12 months of occupancy%/ADR pairs,
// upserted together so a partially-filled year never produces duplicate-key
// errors on the (room_type_id, year_number, month_number) unique index.
export async function saveYearAssumptions(planId: string, roomTypeId: string, yearNumber: number, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const rows = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const occRaw = formData.get(`occ_${month}`);
    const adrRaw = formData.get(`adr_${month}`);
    return {
      org_id: orgId,
      room_type_id: roomTypeId,
      year_number: yearNumber,
      month_number: month,
      occupancy_pct: Math.min(1, Math.max(0, Number(occRaw) || 0) / 100),
      adr: Math.max(0, Number(adrRaw) || 0),
    };
  });

  const { error } = await supabase.from("revenue_plan_assumptions").upsert(rows, {
    onConflict: "room_type_id,year_number,month_number",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/revenue-plans/${planId}`);
}
