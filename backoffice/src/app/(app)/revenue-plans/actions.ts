"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";

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
