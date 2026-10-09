"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MILESTONE_KIND, PHASE_STATUS, TASK_PRIORITY, TASK_STATUS, type TaskStatus } from "@/lib/domain/enums";
import { keyAtEnd, planMove } from "@/lib/planner/sortKey";

// Planner writes. RLS (0040) is the authorization boundary -- these never
// read the org from the session (a partner has none); org_id comes from the
// project via planner_projects(), and planner_guard re-derives it anyway.
// Shared by /planner and, later, the partner space.

type Client = Awaited<ReturnType<typeof createClient>>;

// guid, not uuid: zod 4's uuid() insists on an RFC version nibble, which
// hand-written seed ids lack.
const uuid = z.guid();
const optionalUuid = z.preprocess((v) => (v === "" || v == null ? null : v), uuid.nullable());
const optionalDate = z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
);
const optionalText = z.preprocess((v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}, z.string().max(20_000).nullable());
const title = z.string().trim().min(1).max(500);

function revalidatePlanner(projectId?: string) {
  revalidatePath("/planner", "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function projectOrg(supabase: Client, projectId: string): Promise<string> {
  const { data, error } = await supabase.rpc("planner_projects").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Το έργο δεν βρέθηκε ή δεν έχετε πρόσβαση.");
  return data.org_id;
}

async function taskScope(supabase: Client, taskId: string) {
  const { data, error } = await supabase.from("tasks").select("org_id, project_id").eq("id", taskId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Η εργασία δεν βρέθηκε.");
  return data;
}

function dateRangeOk(start: string | null, end: string | null) {
  if (start && end && end < start) throw new Error("Η λήξη είναι πριν από την έναρξη.");
}

// ── Tasks ──────────────────────────────────────────────────────────────────

const taskFields = z.object({
  title,
  description: optionalText,
  status: z.enum(TASK_STATUS),
  priority: z.enum(TASK_PRIORITY),
  assignee_id: optionalUuid,
  start_date: optionalDate,
  due_date: optionalDate,
});

function readTask(formData: FormData) {
  const fields = taskFields.parse({
    title: formData.get("title"),
    description: formData.get("description"),
    status: formData.get("status") ?? "todo",
    priority: formData.get("priority") ?? "normal",
    assignee_id: formData.get("assignee_id"),
    start_date: formData.get("start_date"),
    due_date: formData.get("due_date"),
  });
  dateRangeOk(fields.start_date, fields.due_date);
  return fields;
}

async function endOfColumnKey(supabase: Client, projectId: string, status: TaskStatus) {
  const { data } = await supabase
    .from("tasks")
    .select("id, sort_key")
    .eq("project_id", projectId)
    .eq("status", status)
    .is("archived_at", null)
    .order("sort_key", { ascending: false })
    .limit(1);
  return keyAtEnd((data ?? []).map((t) => ({ id: t.id, sort_key: Number(t.sort_key) })));
}

export async function createTask(formData: FormData) {
  const supabase = await createClient();
  const projectId = uuid.parse(formData.get("project_id"));
  const fields = readTask(formData);
  const orgId = await projectOrg(supabase, projectId);
  const { error } = await supabase.from("tasks").insert({
    ...fields,
    org_id: orgId,
    project_id: projectId,
    sort_key: await endOfColumnKey(supabase, projectId, fields.status),
  });
  fail(error);
  revalidatePlanner(projectId);
}

export async function updateTask(taskId: string, formData: FormData) {
  const supabase = await createClient();
  uuid.parse(taskId);
  const fields = readTask(formData);
  const scope = await taskScope(supabase, taskId);
  const phaseId = optionalUuid.parse(formData.get("phase_id"));
  const milestoneId = optionalUuid.parse(formData.get("milestone_id"));
  const projectId = optionalUuid.parse(formData.get("project_id")) ?? scope.project_id;
  const moved = projectId !== scope.project_id;

  // Phase and milestone belong to the old project (composite FK), so a move
  // clears them; planner_guard refuses the move for anyone but an editor.
  const { error } = await supabase
    .from("tasks")
    .update({
      ...fields,
      project_id: projectId,
      phase_id: moved ? null : phaseId,
      milestone_id: moved ? null : milestoneId,
    })
    .eq("id", taskId);
  fail(error);
  revalidatePlanner(scope.project_id);
  if (moved) revalidatePlanner(projectId);
}

export type MoveResult = { ok: true } | { ok: false; error: string };

const moveInput = z.object({
  taskId: uuid,
  status: z.enum(TASK_STATUS),
  orderedIds: z.array(uuid).min(1).max(1000),
});

// Drag-and-drop: `orderedIds` is the destination column as the user sees it
// after the drop. Neighbour keys are re-read here rather than trusted from
// the client; one row is written unless the gap ran out (planMove).
export async function moveTask(taskId: string, status: TaskStatus, orderedIds: string[]): Promise<MoveResult> {
  const parsed = moveInput.safeParse({ taskId, status, orderedIds });
  if (!parsed.success || !orderedIds.includes(taskId)) return { ok: false, error: "Μη έγκυρη μετακίνηση." };

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("tasks")
    .select("id, project_id, sort_key")
    .in("id", parsed.data.orderedIds);
  if (error) return { ok: false, error: error.message };

  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const moved = byId.get(taskId);
  if (!moved) return { ok: false, error: "Η εργασία δεν βρέθηκε." };
  const column = parsed.data.orderedIds
    .filter((id) => byId.has(id))
    .map((id) => ({ id, sort_key: Number(byId.get(id)!.sort_key) }));

  const plan = planMove(column, taskId);
  const { error: moveErr } = await supabase
    .from("tasks")
    .update({ status: parsed.data.status, sort_key: plan.sortKey })
    .eq("id", taskId);
  if (moveErr) return { ok: false, error: moveErr.message };

  if (plan.rebalanced) {
    const results = await Promise.all(
      plan.rebalanced
        .filter((r) => r.id !== taskId)
        .map((r) => supabase.from("tasks").update({ sort_key: r.sort_key }).eq("id", r.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return { ok: false, error: failed.error.message };
  }

  revalidatePlanner(moved.project_id);
  return { ok: true };
}

// «Μετακίνηση σε…» on mobile and the status select on the detail page: the
// card goes to the bottom of its new column.
export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<MoveResult> {
  const parsedStatus = z.enum(TASK_STATUS).safeParse(status);
  if (!uuid.safeParse(taskId).success || !parsedStatus.success) return { ok: false, error: "Μη έγκυρη κατάσταση." };
  const supabase = await createClient();
  const scope = await taskScope(supabase, taskId);
  const { error } = await supabase
    .from("tasks")
    .update({ status: parsedStatus.data, sort_key: await endOfColumnKey(supabase, scope.project_id, parsedStatus.data) })
    .eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  revalidatePlanner(scope.project_id);
  return { ok: true };
}

export async function setTaskArchived(taskId: string, archived: boolean) {
  const supabase = await createClient();
  uuid.parse(taskId);
  const scope = await taskScope(supabase, taskId);
  const { error } = await supabase
    .from("tasks")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", taskId);
  fail(error);
  revalidatePlanner(scope.project_id);
}

export async function deleteTask(taskId: string, returnTo: string) {
  const supabase = await createClient();
  uuid.parse(taskId);
  const scope = await taskScope(supabase, taskId);
  // RLS lets only org editors delete; a refused delete affects zero rows
  // rather than erroring, so check it actually happened.
  const { data, error } = await supabase.from("tasks").delete().eq("id", taskId).select("id");
  fail(error);
  if (!data || data.length === 0) throw new Error("Δεν έχετε δικαίωμα διαγραφής.");
  revalidatePlanner(scope.project_id);
  redirect(returnTo.startsWith("/") ? returnTo : "/planner");
}

// ── Checklist ──────────────────────────────────────────────────────────────

export async function addChecklistItem(taskId: string, formData: FormData) {
  const supabase = await createClient();
  uuid.parse(taskId);
  const body = title.parse(formData.get("body"));
  const scope = await taskScope(supabase, taskId);
  const { data: last } = await supabase
    .from("task_checklist_items")
    .select("sort_order")
    .eq("task_id", taskId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("task_checklist_items").insert({
    org_id: scope.org_id,
    project_id: scope.project_id,
    task_id: taskId,
    body,
    sort_order: (last?.sort_order ?? 0) + 1,
  });
  fail(error);
  revalidatePlanner(scope.project_id);
}

export async function toggleChecklistItem(itemId: string, done: boolean) {
  const supabase = await createClient();
  uuid.parse(itemId);
  const { data, error } = await supabase
    .from("task_checklist_items")
    .update({ done })
    .eq("id", itemId)
    .select("project_id")
    .maybeSingle();
  fail(error);
  revalidatePlanner(data?.project_id);
}

export async function deleteChecklistItem(itemId: string) {
  const supabase = await createClient();
  uuid.parse(itemId);
  const { data, error } = await supabase
    .from("task_checklist_items")
    .delete()
    .eq("id", itemId)
    .select("project_id")
    .maybeSingle();
  fail(error);
  revalidatePlanner(data?.project_id);
}

// ── Comments ───────────────────────────────────────────────────────────────

export async function addComment(taskId: string, body: string) {
  const supabase = await createClient();
  uuid.parse(taskId);
  const text = z.string().trim().min(1).max(10_000).parse(body);
  const scope = await taskScope(supabase, taskId);
  // author_id defaults to auth.uid() and RLS insists on it.
  const { error } = await supabase
    .from("task_comments")
    .insert({ org_id: scope.org_id, project_id: scope.project_id, task_id: taskId, body: text });
  fail(error);
  revalidatePlanner(scope.project_id);
}

export async function deleteComment(commentId: string) {
  const supabase = await createClient();
  uuid.parse(commentId);
  const { data, error } = await supabase
    .from("task_comments")
    .delete()
    .eq("id", commentId)
    .select("project_id")
    .maybeSingle();
  fail(error);
  revalidatePlanner(data?.project_id);
}

// ── Phases and milestones (org editors) ────────────────────────────────────

const phaseFields = z.object({
  name: title,
  status: z.enum(PHASE_STATUS),
  planned_start: optionalDate,
  planned_end: optionalDate,
  actual_start: optionalDate,
  actual_end: optionalDate,
  sort_order: z.coerce.number().int().min(0).max(10_000).default(0),
});

export async function savePhase(projectId: string, phaseId: string | null, formData: FormData) {
  const supabase = await createClient();
  uuid.parse(projectId);
  const fields = phaseFields.parse({
    name: formData.get("name"),
    status: formData.get("status") ?? "planned",
    planned_start: formData.get("planned_start"),
    planned_end: formData.get("planned_end"),
    actual_start: formData.get("actual_start"),
    actual_end: formData.get("actual_end"),
    sort_order: formData.get("sort_order") || 0,
  });
  dateRangeOk(fields.planned_start, fields.planned_end);
  dateRangeOk(fields.actual_start, fields.actual_end);
  if (phaseId) {
    const { error } = await supabase.from("project_phases").update(fields).eq("id", uuid.parse(phaseId));
    fail(error);
  } else {
    const orgId = await projectOrg(supabase, projectId);
    const { error } = await supabase.from("project_phases").insert({ ...fields, org_id: orgId, project_id: projectId });
    fail(error);
  }
  revalidatePlanner(projectId);
}

export async function deletePhase(projectId: string, phaseId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("project_phases").delete().eq("id", uuid.parse(phaseId));
  fail(error);
  revalidatePlanner(projectId);
}

const milestoneFields = z.object({
  title,
  description: optionalText,
  kind: z.enum(MILESTONE_KIND),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phase_id: optionalUuid,
});

export async function saveMilestone(projectId: string, milestoneId: string | null, formData: FormData) {
  const supabase = await createClient();
  uuid.parse(projectId);
  const fields = milestoneFields.parse({
    title: formData.get("title"),
    description: formData.get("description"),
    kind: formData.get("kind") ?? "general",
    due_date: formData.get("due_date"),
    phase_id: formData.get("phase_id"),
  });
  if (milestoneId) {
    const { error } = await supabase.from("project_milestones").update(fields).eq("id", uuid.parse(milestoneId));
    fail(error);
  } else {
    const orgId = await projectOrg(supabase, projectId);
    const { error } = await supabase
      .from("project_milestones")
      .insert({ ...fields, org_id: orgId, project_id: projectId });
    fail(error);
  }
  revalidatePlanner(projectId);
}

export async function setMilestoneDone(projectId: string, milestoneId: string, done: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_milestones")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", uuid.parse(milestoneId));
  fail(error);
  revalidatePlanner(projectId);
}

export async function deleteMilestone(projectId: string, milestoneId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("project_milestones").delete().eq("id", uuid.parse(milestoneId));
  fail(error);
  revalidatePlanner(projectId);
}
