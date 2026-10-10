"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { toChangeCard, type ChangeCard } from "@/lib/ai/changeCards";
import { syncLoanSchedule } from "@/lib/finance/scheduleSync";

const CHANGE_COLUMNS =
  "id, status, operation, table_name, action, reason, before, after, changed_fields, conflict, untrusted_context, error, result, created_at";

const idSchema = z.uuid();

async function loadCard(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<ChangeCard> {
  const { data, error } = await supabase.from("agent_changes").select(CHANGE_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) throw new UserError("Η πρόταση δεν βρέθηκε.");
  return toChangeCard(data);
}

// The only path that applies a Kansha Operator proposal: one database call
// (apply_agent_change, 0083) that locks the proposal and the row, refuses a
// second approval, checks the changed fields for staleness and writes only
// allowlisted columns. `force` approves a proposal already in conflict.
// Returns the updated card so the UI can show the conflict or the error.
export async function approveChange(id: string, force = false): Promise<ActionResult<ChangeCard>> {
  return action(async () => {
    if (!idSchema.safeParse(id).success) throw new UserError("Η πρόταση δεν βρέθηκε.");
    const supabase = await createClient();
    // Returns {status, ...}; the reloaded card reflects it (error in Greek).
    const { data: applied, error } = await supabase.rpc("apply_agent_change", { p_change: id, p_force: force });
    if (error) throw error;

    // A loan's terms drive its scheduled instalments in the ledger (0065):
    // rewrite them now, exactly as saveLoan does. A failure here must not
    // undo the approved change; v_qc_schedule_stale flags the loan instead.
    const result = (applied ?? {}) as { status?: string; row_id?: string };
    if (result.status === "approved" && result.row_id) {
      const { data: change } = await supabase.from("agent_changes").select("table_name, operation").eq("id", id).maybeSingle();
      if (change?.table_name === "loans" && change.operation !== "delete") {
        await syncLoanSchedule(supabase, result.row_id).catch((e) => console.error("[approveChange] schedule sync", e));
      }
    }

    revalidatePath("/assistant");
    revalidatePath("/", "layout");
    return loadCard(supabase, id);
  });
}

export async function rejectChange(id: string): Promise<ActionResult<ChangeCard>> {
  return action(async () => {
    if (!idSchema.safeParse(id).success) throw new UserError("Η πρόταση δεν βρέθηκε.");
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("agent_changes")
      .update({ status: "rejected", reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["pending", "conflict", "failed"])
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new UserError("Αυτή η πρόταση έχει ήδη διεκπεραιωθεί.");
    revalidatePath("/assistant");
    revalidatePath("/", "layout");
    return loadCard(supabase, id);
  });
}
