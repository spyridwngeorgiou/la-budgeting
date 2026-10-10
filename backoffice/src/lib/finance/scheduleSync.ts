import "server-only";
import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/db/types";
import type { createClient } from "@/lib/supabase/server";
import { UserError } from "@/lib/actions";
import { leaseScheduleRows, loanScheduleRows, type ScheduleRow } from "./scheduleRows";

// Writes a loan's / lease's payment schedule into the ledger as scheduled
// transactions (sync_schedule_rows, 0065). Called after every save that can
// change a schedule -- saveLoan and its drawdowns, an approved AI change to
// a loan, the «Συγχρονισμός» button v_qc_schedule_stale points to. The maths
// is loan.ts / lease.ts; SQL only stores the rows and protects paid ones.
// Takes the caller's RLS-scoped client: the database decides who may write.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface SyncSummary {
  upserted: number;
  protected: number;
  removed: number;
}

async function store(supabase: Supabase, kind: "loan" | "lease", id: string, rows: ScheduleRow[]): Promise<SyncSummary> {
  const { data, error } = await supabase.rpc("sync_schedule_rows", {
    p_kind: kind,
    p_source_id: id,
    p_rows: rows as unknown as Database["public"]["Functions"]["sync_schedule_rows"]["Args"]["p_rows"],
  });
  if (error) throw error;
  const r = data?.[0];
  return { upserted: r?.upserted ?? 0, protected: r?.protected ?? 0, removed: r?.removed ?? 0 };
}

export async function syncLoanSchedule(supabase: Supabase, loanId: string): Promise<SyncSummary> {
  const { data: loan, error } = await supabase
    .from("loans")
    .select(
      "id, label, principal, interest_rate, term_years, grace_years, first_amortisation_month, state, project_id, loan_drawdowns(scheduled_month, amount, actual_date, actual_amount)",
    )
    .eq("id", loanId)
    .maybeSingle();
  if (error) throw error;
  if (!loan) throw new UserError("Το δάνειο δεν βρέθηκε.");
  const summary = await store(supabase, "loan", loanId, loanScheduleRows(loan));
  revalidateFinance(loan.project_id);
  return summary;
}

export async function syncLeaseSchedule(supabase: Supabase, leaseId: string): Promise<SyncSummary> {
  const { data: lease, error } = await supabase
    .from("project_leases")
    .select(
      "id, kind, term_years, lease_start_month, first_payment_month, project_id, projects(display_name), lease_indexed_terms!lease_indexed_terms_lease_id_fkey(base_monthly_amount, stamp_duty_pct, stamp_duty_surcharge_pct, escalation_pct, escalation_first_year, stepups_escalate, stepups_stampable, lease_step_ups(from_lease_year, monthly_amount))",
    )
    .eq("id", leaseId)
    .maybeSingle();
  if (error) throw error;
  if (!lease) throw new UserError("Η μίσθωση δεν βρέθηκε.");
  const project = Array.isArray(lease.projects) ? lease.projects[0] : lease.projects;
  const summary = await store(supabase, "lease", leaseId, leaseScheduleRows(lease, project?.display_name ?? ""));
  revalidateFinance(lease.project_id);
  return summary;
}

function revalidateFinance(projectId: string | null) {
  if (projectId) revalidatePath(`/projects/${projectId}`);
  revalidatePath("/reports/cash");
  revalidatePath("/reports/quality");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}
