"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ALLOWLIST, type WritableTable } from "@/lib/ai/writeTools";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { syncLoanSchedule } from "@/lib/finance/scheduleSync";

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

// The only path that actually applies a Kansha Operator proposal -- never
// trusts the stored `after` blob directly, re-filters it through the same
// editable-field allowlist the proposal itself was built from, so a
// tampered or stale row can never write an unexpected column.
export async function approveChange(id: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { data: change, error } = await supabase.from("agent_changes").select("*").eq("id", id).maybeSingle();
    if (error || !change) throw new UserError("Η πρόταση δεν βρέθηκε.");
    if (change.status !== "pending") throw new UserError("Αυτή η πρόταση έχει ήδη διεκπεραιωθεί.");

    const table = change.table_name as WritableTable;
    const spec = ALLOWLIST[table];
    if (!spec) throw new UserError(`Άγνωστος πίνακας: ${change.table_name}`);

    // The allowlist filter above is the real safety boundary (only vetted
    // columns on vetted tables ever reach a write); these `as never` casts
    // just satisfy Supabase's per-table generated types, which can't express
    // "one of several known tables chosen at runtime".
    let writtenId: string | null = null;
    if (change.operation === "insert") {
      const payload = pick(change.after as Record<string, unknown>, spec.editableFields);
      const { data: inserted, error: insErr } = await supabase
        .from(table)
        .insert({ ...payload, org_id: change.org_id } as never)
        .select("id")
        .single();
      if (insErr) throw insErr;
      writtenId = (inserted as { id: string } | null)?.id ?? null;
    } else if (change.operation === "update") {
      const payload = pick(change.after as Record<string, unknown>, spec.editableFields);
      const { error: updErr } = await supabase.from(table).update(payload as never).eq("id", change.row_id as string);
      if (updErr) throw updErr;
      writtenId = change.row_id as string;
    } else {
      const { error: delErr } = await supabase.from(table).delete().eq("id", change.row_id as string);
      if (delErr) throw delErr;
    }

    // A loan's terms drive its scheduled instalments in the ledger: rewrite
    // them now, exactly as saveLoan does, so the forecast is never stale.
    // A failure here must not leave the applied change looking pending (it
    // would invite a second approval); v_qc_schedule_stale flags the loan.
    if (table === "loans" && writtenId) {
      await syncLoanSchedule(supabase, writtenId).catch((e) => console.error("[approveChange] schedule sync", e));
    }

    await supabase
      .from("agent_changes")
      .update({ status: "approved", reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() })
      .eq("id", id);

    revalidatePath("/assistant");
    revalidatePath("/", "layout");
  });
}

export async function rejectChange(id: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { error } = await supabase
      .from("agent_changes")
      .update({ status: "rejected", reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending");
    if (error) throw error;
    revalidatePath("/assistant");
    revalidatePath("/", "layout");
  });
}
