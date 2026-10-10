"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import {
  PROJECT_NOTE_KIND_ACTIVE,
  type BusinessModel,
  type ProjectNoteKindActive,
  type ProjectNoteSeverity,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/domain/enums";
import { revalidateProject } from "./revalidate";

// The project itself and its status / risk notes. One of the four action
// files of the project page (actions, [id]/finance-actions,
// [id]/scenario-actions, [id]/partner-actions); note-actions was merged
// here in Φ4.

function fieldsFromForm(formData: FormData) {
  return {
    code: String(formData.get("code")),
    display_name: String(formData.get("display_name")),
    project_type: (formString(formData, "project_type") as ProjectType) ?? null,
    status: (formString(formData, "status") as ProjectStatus) ?? "active",
    business_model: (formString(formData, "business_model") as BusinessModel) ?? null,
    start_date: formString(formData, "start_date"),
    contract_value: formData.get("contract_value") ? Number(formData.get("contract_value")) : null,
    contract_signed_date: formString(formData, "contract_signed_date"),
  };
}

export async function createProject(formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { error } = await supabase.from("projects").insert({
    ...fieldsFromForm(formData),
    org_id: orgId,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/projects");
}

export async function updateProject(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update(fieldsFromForm(formData)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/projects");
  revalidateProject(id);
}

// ── Status and risk notes ─────────────────────────────────────────────────────

// project_notes was previously only writable through the Kansha AI chat's
// propose-and-approve flow (src/lib/ai/writeTools.ts ALLOWLIST). Same
// editable shape as the ALLOWLIST entry. Since 0041 the table CHECKs kind in
// (status, risk); anything else from the form falls back to status rather
// than failing on the constraint.
function noteKind(value: string | null): ProjectNoteKindActive {
  return (PROJECT_NOTE_KIND_ACTIVE as readonly string[]).includes(value ?? "")
    ? (value as ProjectNoteKindActive)
    : "status";
}

export async function saveProjectNote(projectId: string, noteId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const fields = {
    project_id: projectId,
    kind: noteKind(formString(formData, "kind")),
    severity: (formString(formData, "severity") as ProjectNoteSeverity) ?? "info",
    body: String(formData.get("body")),
    exposure_amount: formData.get("exposure_amount") ? Number(formData.get("exposure_amount")) : null,
    due_date: formString(formData, "due_date"),
  };

  if (noteId) {
    const { error } = await supabase.from("project_notes").update(fields).eq("id", noteId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("project_notes").insert({ ...fields, org_id: orgId });
    if (error) throw new Error(error.message);
  }
  revalidateProject(projectId);
}

export async function resolveProjectNote(projectId: string, noteId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_notes")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", noteId);
  if (error) throw new Error(error.message);
  revalidateProject(projectId);
}
