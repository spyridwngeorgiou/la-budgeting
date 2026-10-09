"use server";

import { createClient } from "@/lib/supabase/server";
import { action, type ActionResult } from "@/lib/actions";
import { syncLeaseSchedule, syncLoanSchedule, type SyncSummary } from "@/lib/finance/scheduleSync";

// Server actions over src/lib/finance/scheduleSync.ts: re-write a loan's or
// lease's payment schedule into the ledger. saveLoan calls the sync
// directly; these are for the buttons (project page, /reports/quality).

export async function syncLoanScheduleAction(loanId: string): Promise<ActionResult<SyncSummary>> {
  return action(async () => syncLoanSchedule(await createClient(), loanId));
}

export async function syncLeaseScheduleAction(leaseId: string): Promise<ActionResult<SyncSummary>> {
  return action(async () => syncLeaseSchedule(await createClient(), leaseId));
}

// One stale source from v_qc_schedule_stale.
export async function syncStaleSchedule(kind: string, id: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    if (kind === "loan") await syncLoanSchedule(supabase, id);
    else await syncLeaseSchedule(supabase, id);
  });
}
