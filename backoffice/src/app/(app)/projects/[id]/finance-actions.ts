"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { syncLeaseSchedule, syncLoanSchedule, type SyncSummary } from "@/lib/finance/scheduleSync";
import { firstOfMonth, isMonthKey } from "@/lib/dates";
import type { BudgetLineCode, CapitalSourceKind, LiabilityState } from "@/lib/domain/enums";
import type { Database } from "@/lib/db/types";
import { revalidateProject } from "../revalidate";

// Οικονομικά: the project's money writes -- budget, loans, capital, utilities
// and the lease/loan schedule sync. One of the four action files of the
// project page (actions, [id]/finance-actions, [id]/scenario-actions,
// [id]/partner-actions); the old per-table files were merged here in Φ4.

// ── Budget ────────────────────────────────────────────────────────────────

const LINES: BudgetLineCode[] = [
  "acquisition",
  "studies_permits_legal",
  "construction_equipment",
  "other",
];

// Budgets are versioned: saving always creates a new current version rather
// than overwriting the old one in place (the workbook has no history at
// all -- a revision just clobbers last month's numbers).
export async function saveProjectBudget(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { data: existing } = await supabase
    .from("project_budgets")
    .select("id, version")
    .eq("project_id", projectId)
    .eq("is_current", true)
    .maybeSingle();

  if (existing) {
    await supabase.from("project_budgets").update({ is_current: false }).eq("id", existing.id);
  }

  const { data: budget, error } = await supabase
    .from("project_budgets")
    .insert({
      org_id: orgId,
      project_id: projectId,
      version: (existing?.version ?? 0) + 1,
      is_current: true,
      contingency_pct: Number(formData.get("contingency_pct") ?? 0),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const lines = LINES.map((line) => ({
    org_id: orgId,
    budget_id: budget.id,
    line_code: line,
    amount: Number(formData.get(`line_${line}`) ?? 0),
  }));

  const { error: linesError } = await supabase.from("budget_lines").insert(lines);
  if (linesError) throw new Error(linesError.message);

  revalidateProject(projectId);
}

// ── Loans ─────────────────────────────────────────────────────────────────

// Loans were previously editable only through the Kansha AI chat's
// propose-and-approve flow (src/lib/ai/writeTools.ts ALLOWLIST) -- useful
// for a quick AI-driven edit, but there was no direct form, so entering a
// new loan tranche meant either asking the AI or a raw DB edit. Same
// project_id-scoped shape as ALLOWLIST's "loans" entry.
//
// Every save re-writes the loan's payment schedule into the ledger
// (scheduleSync.ts), so the cash forecast always carries the instalments
// the engine computes from what was just saved.
function loanFieldsFromForm(formData: FormData, projectId: string) {
  const principal = Number(formData.get("principal"));
  const rate = Number(formData.get("interest_rate_pct"));
  const term = Number(formData.get("term_years"));
  if (!Number.isFinite(principal) || principal <= 0) throw new UserError("Το κεφάλαιο πρέπει να είναι θετικό ποσό.");
  if (!Number.isFinite(rate) || rate < 0) throw new UserError("Μη έγκυρο επιτόκιο.");
  if (!Number.isInteger(term) || term <= 0) throw new UserError("Η διάρκεια πρέπει να είναι ακέραιος αριθμός ετών.");
  return {
    project_id: projectId,
    label: String(formData.get("label")),
    principal,
    interest_rate: rate / 100,
    term_years: term,
    grace_years: Number(formData.get("grace_years") ?? 0),
    first_amortisation_month: formString(formData, "first_amortisation_month"),
    state: (formString(formData, "state") as LiabilityState) ?? "in_application",
    notes: formString(formData, "notes"),
  };
}

// drawdown_month[] (YYYY-MM), drawdown_amount[], drawdown_done[] ("1" = it
// happened), one entry per row of the modal's drawdown list.
function drawdownsFromForm(formData: FormData) {
  const months = formData.getAll("drawdown_month").map(String);
  const amounts = formData.getAll("drawdown_amount").map(String);
  const done = formData.getAll("drawdown_done").map(String);
  const rows: { scheduled_month: string; amount: number; actual_date: string | null; actual_amount: number | null }[] = [];
  months.forEach((m, i) => {
    const amountText = (amounts[i] ?? "").trim();
    if (!m && !amountText) return; // an empty row the user never filled in
    const amount = Number(amountText);
    if (!isMonthKey(m)) throw new UserError("Κάθε εκταμίευση χρειάζεται μήνα.");
    if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Κάθε εκταμίευση χρειάζεται θετικό ποσό.");
    const happened = done[i] === "1";
    rows.push({
      scheduled_month: firstOfMonth(m),
      amount,
      actual_date: happened ? firstOfMonth(m) : null,
      actual_amount: happened ? amount : null,
    });
  });
  return rows;
}

export async function saveLoan(projectId: string, loanId: string | null, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const fields = loanFieldsFromForm(formData, projectId);
    const drawdowns = drawdownsFromForm(formData);

    let id = loanId;
    if (id) {
      const { error } = await supabase.from("loans").update(fields).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("loans").insert({ ...fields, org_id: orgId }).select("id").single();
      if (error) throw error;
      id = data.id;
    }

    // Drawdowns are replaced as a set: the modal always submits the full list.
    if (formData.has("drawdowns_present")) {
      const { error: delErr } = await supabase.from("loan_drawdowns").delete().eq("loan_id", id);
      if (delErr) throw delErr;
      if (drawdowns.length > 0) {
        const { error: insErr } = await supabase
          .from("loan_drawdowns")
          .insert(drawdowns.map((d) => ({ ...d, loan_id: id!, org_id: orgId })));
        if (insErr) throw insErr;
      }
    }

    await syncLoanSchedule(supabase, id!);
    revalidateProject(projectId);
  });
}

export async function deleteLoan(projectId: string, loanId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    // The 0065 trigger removes the loan's unpaid scheduled rows and detaches
    // the paid ones, so nothing paid disappears with the loan.
    const { error } = await supabase.from("loans").delete().eq("id", loanId);
    if (error) throw error;
    revalidateProject(projectId);
    revalidatePath("/reports/cash");
  });
}

// ── Capital sources ───────────────────────────────────────────────────────

function capitalFieldsFromForm(formData: FormData, projectId: string) {
  return {
    project_id: projectId,
    kind: String(formData.get("kind")) as CapitalSourceKind,
    contributor: formString(formData, "contributor"),
    amount: Number(formData.get("amount")),
    contributed_on: String(formData.get("contributed_on")),
    notes: formString(formData, "notes"),
  };
}

export async function saveCapitalSource(projectId: string, sourceId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const fields = capitalFieldsFromForm(formData, projectId);

  if (sourceId) {
    const { error } = await supabase.from("project_capital_sources").update(fields).eq("id", sourceId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("project_capital_sources").insert({ ...fields, org_id: orgId });
    if (error) throw new Error(error.message);
  }
  revalidateProject(projectId);
}

export async function deleteCapitalSource(projectId: string, sourceId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("project_capital_sources").delete().eq("id", sourceId);
  if (error) throw new Error(error.message);
  revalidateProject(projectId);
}

// ── Utilities ─────────────────────────────────────────────────────────────

type UtilityKind = Database["public"]["Enums"]["utility_kind"];

export async function saveUtility(projectId: string, utilityId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const fields = {
    project_id: projectId,
    kind: (formString(formData, "kind") ?? "electricity") as UtilityKind,
    provider: formString(formData, "provider"),
    supply_number: formString(formData, "supply_number"),
    contract_account: formString(formData, "contract_account"),
    rf_code: formString(formData, "rf_code"),
    meter_number: formString(formData, "meter_number"),
    notes: formString(formData, "notes"),
  };

  const { error } = utilityId
    ? await supabase.from("property_utilities").update(fields).eq("id", utilityId)
    : await supabase.from("property_utilities").insert({ ...fields, org_id: orgId });
  if (error) throw new Error(error.message);
  revalidateProject(projectId);
  revalidatePath("/projects/properties");
}

export async function deleteUtility(projectId: string, utilityId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("property_utilities").delete().eq("id", utilityId);
  if (error) throw new Error(error.message);
  revalidateProject(projectId);
  revalidatePath("/projects/properties");
}

// ── Schedules ─────────────────────────────────────────────────────────────

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
