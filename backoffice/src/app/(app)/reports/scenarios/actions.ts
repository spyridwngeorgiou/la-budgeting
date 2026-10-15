"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { decodeChanges, encodeChange } from "@/lib/finance/whatIf";

// Saved scenarios (forecast_scenarios, 0098): a name and the page's ?c=
// list, as is. Plain form actions that end on the page again, the saved
// scenario open (?s=); a refused write (a viewer, RLS) comes back as ?err=save.

function back(id: string | null, changes: string[], months: string | null, err?: string): never {
  const p = new URLSearchParams();
  if (months && months !== "12") p.set("months", months);
  if (id) p.set("s", id);
  for (const c of changes) p.append("c", c);
  if (err) p.set("err", err);
  const s = p.toString();
  redirect(s ? `/reports/scenarios?${s}` : "/reports/scenarios");
}

export async function saveScenario(formData: FormData) {
  const id = String(formData.get("id") ?? "") || null;
  const asNew = formData.get("mode") === "new";
  const months = String(formData.get("months") ?? "") || null;
  // Only well-formed changes are kept, written back in their canonical form.
  const changes = decodeChanges(formData.getAll("c").map(String)).map(encodeChange);
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name || changes.length === 0) back(id, changes, months, "name");

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  let savedId = id;
  if (id && !asNew) {
    const { error } = await supabase.from("forecast_scenarios").update({ name, changes }).eq("id", id).eq("org_id", orgId);
    if (error) back(id, changes, months, "save");
  } else {
    const { data, error } = await supabase.from("forecast_scenarios").insert({ org_id: orgId, name, changes }).select("id").single();
    if (error || !data) back(id, changes, months, "save");
    savedId = data.id;
  }
  revalidatePath("/reports/scenarios");
  back(savedId, changes, months);
}

export async function deleteScenario(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const months = String(formData.get("months") ?? "") || null;
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { error } = await supabase.from("forecast_scenarios").delete().eq("id", id).eq("org_id", orgId);
  if (error) back(id, decodeChanges(formData.getAll("c").map(String)).map(encodeChange), months, "save");
  revalidatePath("/reports/scenarios");
  back(null, [], months);
}
