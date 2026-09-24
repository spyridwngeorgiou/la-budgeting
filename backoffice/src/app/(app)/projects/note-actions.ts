"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { ProjectNoteKind, ProjectNoteSeverity } from "@/lib/domain/enums";

// project_notes was previously only writable through the Kansha AI chat's
// propose-and-approve flow (src/lib/ai/writeTools.ts ALLOWLIST) --
// StatusNotes (src/components/onepager.tsx) only ever displayed them,
// read-only. Same editable shape as the ALLOWLIST entry.
export async function saveProjectNote(projectId: string, noteId: string | null, formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const fields = {
    project_id: projectId,
    kind: (formString(formData, "kind") as ProjectNoteKind) ?? "status",
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
  revalidatePath(`/projects/${projectId}`);
}

export async function resolveProjectNote(projectId: string, noteId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_notes")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", noteId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
