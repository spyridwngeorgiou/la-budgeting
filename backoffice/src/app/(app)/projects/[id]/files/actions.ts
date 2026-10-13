"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// The browser uploads the file straight to the private "documents" bucket
// (server actions cap request bodies, Storage does not); this only records it
// in the project's catalogue. RLS on project_files lets editors and above
// insert; the path must sit under this project's folder of this org.
export async function registerUpload(
  projectId: string,
  file: { path: string; title: string; mime: string | null; size: number; category: string },
) {
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("org_id").eq("id", projectId).maybeSingle();
  if (!project) throw new Error("Το έργο δεν βρέθηκε.");
  if (!file.path.startsWith(`${project.org_id}/projects/${projectId}/`)) throw new Error("Λάθος διαδρομή αρχείου.");

  const { error } = await supabase.from("project_files").insert({
    org_id: project.org_id,
    project_id: projectId,
    folder: [file.category],
    title: file.title,
    mime_type: file.mime,
    size_bytes: file.size,
    source: "upload",
    storage_path: file.path,
    file_modified_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/files`);
}
