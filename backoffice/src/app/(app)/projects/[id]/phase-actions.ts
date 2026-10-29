"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Moving a phase: only planned_start/planned_end change here; the database
// (0034, shift_phase) moves the phase's open payments and the phases that
// depend on it by the same number of days.
export async function movePhase(projectId: string, phaseId: string, formData: FormData) {
  const to = String(formData.get("start") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Διάλεξε ημερομηνία.");
  const supabase = await createClient();
  const { data: phase, error } = await supabase.from("project_phases").select("planned_start, planned_end").eq("id", phaseId).single();
  if (error) throw new Error(error.message);
  const delta = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${phase.planned_start}T00:00:00Z`)) / 86400000);
  if (!delta) return;
  const end = new Date(Date.parse(`${phase.planned_end}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
  const { error: e2 } = await supabase.from("project_phases").update({ planned_start: to, planned_end: end }).eq("id", phaseId);
  if (e2) throw new Error(e2.message);
  revalidatePath(`/projects/${projectId}`);
}

// Hang an open payment on a phase (or take it off with an empty choice).
export async function setPaymentPhase(projectId: string, transactionId: string, formData: FormData) {
  const phaseId = String(formData.get("phase_id") ?? "") || null;
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").update({ phase_id: phaseId }).eq("id", transactionId).eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
