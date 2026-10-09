"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { formString } from "@/lib/supabase/org";
import { el } from "@/lib/i18n/el";
import { isBoardTemplate, type StoredTemplate } from "@/lib/collab/templates";

// Callable by partners (lead/contributor) as well as staff: authorization
// is entirely RLS and 0060's boards_guard (trash: creator, lead or org
// editor), and the org is copied from the project by trigger, so nothing
// here needs -- or trusts -- the caller's org.

export type CollabActionResult = { ok: true } | { ok: false; error: string };

const uuid = z.uuid();
const fail = (error: string): CollabActionResult => ({ ok: false, error });

export async function createBoard(projectId: string, formData: FormData) {
  if (!uuid.safeParse(projectId).success) throw new Error(el.partner.errors.projectNotFound);
  const supabase = await createClient();
  const rawTemplate = formString(formData, "template");
  const template: StoredTemplate | null =
    isBoardTemplate(rawTemplate) && rawTemplate !== "blank" ? rawTemplate : null;
  const title =
    (formString(formData, "title") ?? "").trim().slice(0, 200) ||
    (template ? el.collab.templates[template].name : el.collab.project.newBoardTitle);

  const { data: project } = await supabase.rpc("my_collab_projects").eq("project_id", projectId).maybeSingle();
  if (!project) throw new Error(el.partner.errors.projectNotFound);

  const { data, error } = await supabase
    .from("boards")
    .insert({ project_id: projectId, org_id: project.org_id, title, template })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/collab/${projectId}/board/${data.id}`);
}

export async function renameBoard(projectId: string, boardId: string, title: string): Promise<CollabActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(boardId).success) return fail(el.collabAi.error.badRequest);
  const clean = title.trim().slice(0, 200);
  if (!clean) return fail(el.collabAi.error.badRequest);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .update({ title: clean })
    .eq("id", boardId)
    .eq("project_id", projectId)
    .select("id");
  if (error || !data?.length) return fail(el.collab.board.saveError);
  revalidatePath(`/collab/${projectId}`);
  return { ok: true };
}

async function setTrashed(projectId: string, boardId: string, trashed: boolean): Promise<CollabActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(boardId).success) return fail(el.collabAi.error.badRequest);
  const supabase = await createClient();
  // The timestamp itself is set by boards_guard; any non-null value trashes.
  const { data, error } = await supabase
    .from("boards")
    .update({ deleted_at: trashed ? new Date().toISOString() : null })
    .eq("id", boardId)
    .eq("project_id", projectId)
    .select("id");
  if (error) return fail(/42501|trash/i.test(error.message) ? el.collab.trash.notAllowed : el.collab.board.saveError);
  if (!data?.length) return fail(el.collab.trash.notAllowed);
  revalidatePath(`/collab/${projectId}`);
  return { ok: true };
}

export async function trashBoard(projectId: string, boardId: string) {
  return setTrashed(projectId, boardId, true);
}

export async function restoreBoard(projectId: string, boardId: string) {
  return setTrashed(projectId, boardId, false);
}

// Deleting for good, from the trash only. The board's bucket folder is
// cleared first (with the board row gone, collab_path_ok() would refuse
// every path under it), but only after checking the caller is one of the
// people boards_delete allows -- so a refused delete never loses files.
export async function deleteBoardForever(projectId: string, boardId: string): Promise<CollabActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(boardId).success) return fail(el.collabAi.error.badRequest);
  const supabase = await createClient();
  const [{ data: board }, { data: canManage }, { data: auth }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, org_id, project_id, created_by, deleted_at")
      .eq("id", boardId)
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase.rpc("can_manage_collab", { p_project: projectId }),
    supabase.auth.getUser(),
  ]);
  if (!board || !board.deleted_at) return fail(el.collab.trash.notAllowed);
  if (canManage !== true && board.created_by !== auth.user?.id) return fail(el.collab.trash.notAllowed);

  const folder = `${board.org_id}/${board.project_id}/${board.id}`;
  for (let round = 0; round < 20; round++) {
    const { data: objects } = await supabase.storage.from("collab").list(folder, { limit: 100 });
    const names = (objects ?? []).filter((o) => o.name).map((o) => `${folder}/${o.name}`);
    if (names.length === 0) break;
    const { data: removed } = await supabase.storage.from("collab").remove(names);
    // Nothing removable left (e.g. objects we may not delete): stop.
    if (!removed || removed.length === 0) break;
  }

  const { data, error } = await supabase.from("boards").delete().eq("id", boardId).select("id");
  if (error || !data?.length) return fail(el.collab.trash.notAllowed);
  revalidatePath(`/collab/${projectId}`);
  return { ok: true };
}

// Deletes a file (and any PDF page images rendered from it): the rows first
// -- board_files_delete decides who may -- then the bucket objects.
// Elements still pointing at it show «Το αρχείο αφαιρέθηκε».
export async function deleteCollabFile(projectId: string, fileId: string): Promise<CollabActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(fileId).success) return fail(el.collabAi.error.badRequest);
  const supabase = await createClient();
  const [{ data: file }, { data: derived }] = await Promise.all([
    supabase.from("board_files").select("id, storage_path").eq("id", fileId).eq("project_id", projectId).maybeSingle(),
    supabase.from("board_files").select("storage_path").eq("derived_from", fileId).eq("project_id", projectId),
  ]);
  if (!file) return fail(el.collab.fileLibrary.cannotDelete);

  const { data, error } = await supabase.from("board_files").delete().eq("id", fileId).select("id");
  if (error || !data?.length) return fail(el.collab.fileLibrary.cannotDelete);

  // Best effort: a leftover object is unreachable without its row.
  await supabase.storage.from("collab").remove([file.storage_path, ...(derived ?? []).map((d) => d.storage_path)]);
  revalidatePath(`/collab/${projectId}`);
  return { ok: true };
}
