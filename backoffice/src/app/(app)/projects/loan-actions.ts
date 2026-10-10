"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { syncLoanSchedule } from "@/lib/finance/scheduleSync";
import { firstOfMonth, isMonthKey } from "@/lib/dates";
import type { LiabilityState } from "@/lib/domain/enums";

// Loans were previously editable only through the Kansha AI chat's
// propose-and-approve flow (src/lib/ai/writeTools.ts ALLOWLIST) -- useful
// for a quick AI-driven edit, but there was no direct form, so entering a
// new loan tranche meant either asking the AI or a raw DB edit. Same
// project_id-scoped shape as ALLOWLIST's "loans" entry.
//
// Every save re-writes the loan's payment schedule into the ledger
// (scheduleSync.ts), so the cash forecast always carries the instalments
// the engine computes from what was just saved.
function fieldsFromForm(formData: FormData, projectId: string) {
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
    const fields = fieldsFromForm(formData, projectId);
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
    revalidatePath(`/projects/${projectId}`);
  });
}

export async function deleteLoan(projectId: string, loanId: string): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    // The 0065 trigger removes the loan's unpaid scheduled rows and detaches
    // the paid ones, so nothing paid disappears with the loan.
    const { error } = await supabase.from("loans").delete().eq("id", loanId);
    if (error) throw error;
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/reports/cash");
  });
}
