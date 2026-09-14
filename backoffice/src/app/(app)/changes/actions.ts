"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ALLOWLIST, type WritableTable } from "@/lib/ai/writeTools";

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

// The only path that actually applies a Kansha Operator proposal -- never
// trusts the stored `after` blob directly, re-filters it through the same
// editable-field allowlist the proposal itself was built from, so a
// tampered or stale row can never write an unexpected column.
export async function approveChange(id: string) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { data: change, error } = await supabase.from("agent_changes").select("*").eq("id", id).maybeSingle();
  if (error || !change) throw new Error("Η πρόταση δεν βρέθηκε.");
  if (change.status !== "pending") throw new Error("Αυτή η πρόταση έχει ήδη διεκπεραιωθεί.");

  const table = change.table_name as WritableTable;
  const spec = ALLOWLIST[table];
  if (!spec) throw new Error(`Άγνωστος πίνακας: ${change.table_name}`);

  // The allowlist filter above is the real safety boundary (only vetted
  // columns on vetted tables ever reach a write); these `as never` casts
  // just satisfy Supabase's per-table generated types, which can't express
  // "one of several known tables chosen at runtime".
  if (change.operation === "insert") {
    const payload = pick(change.after as Record<string, unknown>, spec.editableFields);
    const { error: insErr } = await supabase.from(table).insert({ ...payload, org_id: change.org_id } as never);
    if (insErr) throw new Error(insErr.message);
  } else if (change.operation === "update") {
    const payload = pick(change.after as Record<string, unknown>, spec.editableFields);
    const { error: updErr } = await supabase.from(table).update(payload as never).eq("id", change.row_id as string);
    if (updErr) throw new Error(updErr.message);
  } else {
    const { error: delErr } = await supabase.from(table).delete().eq("id", change.row_id as string);
    if (delErr) throw new Error(delErr.message);
  }

  await supabase
    .from("agent_changes")
    .update({ status: "approved", reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/changes");
}

export async function rejectChange(id: string) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { error } = await supabase
    .from("agent_changes")
    .update({ status: "rejected", reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  revalidatePath("/changes");
}
