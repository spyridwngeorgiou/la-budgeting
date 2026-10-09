"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formString } from "@/lib/supabase/org";

// Callable by partners (lead/contributor) as well as staff: authorization
// is entirely RLS (boards_insert / boards_update -> can_edit_collab), and
// the org is copied from the project by trigger, so nothing here needs --
// or trusts -- the caller's org.

export async function createBoard(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const title = (formString(formData, "title") ?? "").trim().slice(0, 200) || "Πίνακας";

  const { data: project } = await supabase.rpc("my_collab_projects").eq("project_id", projectId).maybeSingle();
  if (!project) throw new Error("Το έργο δεν βρέθηκε.");

  const { data, error } = await supabase
    .from("boards")
    .insert({ project_id: projectId, org_id: project.org_id, title })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/collab/${projectId}/board/${data.id}`);
}

export async function archiveBoard(projectId: string, boardId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", boardId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/collab/${projectId}`);
}
