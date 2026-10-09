import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { MilestoneKind, PhaseStatus, TaskPriority, TaskStatus } from "@/lib/domain/enums";
import { toCalendarItems, type CalendarItem } from "./calendar";

// Planner reads, shared by /planner and (later) the partner space at
// /collab/[projectId]. Everything goes through the caller's own client, so
// RLS decides what comes back; nothing here adds an org filter because a
// partner has no org -- scoping is by project instead.

type Client = SupabaseClient<Database>;

export interface PlannerProject {
  id: string;
  org_id: string;
  code: string;
  display_name: string;
}

export interface PlannerPerson {
  user_id: string;
  label: string;
}

export interface BoardTask {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  sort_key: number;
  archived_at: string | null;
  checklist_done: number;
  checklist_total: number;
  comment_count: number;
}

export interface BoardFilters {
  projectId?: string | null;
  // A user id, "none" for unassigned, or absent for everyone.
  assignee?: string | null;
  q?: string | null;
  archived?: boolean;
}

// The projects the caller can plan against (planner_projects(), 0040), scoped
// to one org for org users -- someone in two orgs sees the current one only.
export async function loadPlannerProjects(supabase: Client, orgId?: string | null): Promise<PlannerProject[]> {
  let query = supabase.rpc("planner_projects");
  if (orgId) query = query.eq("org_id", orgId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, org_id: p.org_id, code: p.code, display_name: p.display_name }));
}

export async function loadPlannerPeople(supabase: Client, projectId?: string | null): Promise<PlannerPerson[]> {
  const { data, error } = await supabase.rpc("planner_people", projectId ? { p_project: projectId } : {});
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const people: PlannerPerson[] = [];
  for (const p of data ?? []) {
    if (seen.has(p.user_id)) continue;
    seen.add(p.user_id);
    people.push({ user_id: p.user_id, label: p.display_name || p.email || "—" });
  }
  return people.sort((a, b) => a.label.localeCompare(b.label, "el"));
}

export async function loadBoardTasks(
  supabase: Client,
  projectIds: string[],
  filters: BoardFilters,
): Promise<BoardTask[]> {
  if (projectIds.length === 0) return [];
  let query = supabase
    .from("tasks")
    .select(
      "id, project_id, title, status, priority, assignee_id, start_date, due_date, sort_key, archived_at, task_checklist_items(done), task_comments(count)",
    )
    .in("project_id", filters.projectId ? [filters.projectId] : projectIds)
    .order("sort_key")
    .limit(1000);
  query = filters.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (filters.assignee === "none") query = query.is("assignee_id", null);
  else if (filters.assignee) query = query.eq("assignee_id", filters.assignee);
  if (filters.q) query = query.ilike("title", `%${filters.q.replace(/[%_]/g, "\\$&")}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => {
    const items = t.task_checklist_items ?? [];
    const comments = t.task_comments as unknown as { count: number }[] | null;
    return {
      id: t.id,
      project_id: t.project_id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignee_id: t.assignee_id,
      start_date: t.start_date,
      due_date: t.due_date,
      sort_key: Number(t.sort_key),
      archived_at: t.archived_at,
      checklist_done: items.filter((i) => i.done).length,
      checklist_total: items.length,
      comment_count: comments?.[0]?.count ?? 0,
    };
  });
}

export interface TimelinePhase {
  id: string;
  project_id: string;
  name: string;
  status: PhaseStatus;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  sort_order: number;
}

export interface TimelineMilestone {
  id: string;
  project_id: string;
  phase_id: string | null;
  title: string;
  kind: MilestoneKind;
  due_date: string;
  done_at: string | null;
  description: string | null;
}

export interface TimelineTask {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  start_date: string | null;
  due_date: string | null;
}

export async function loadSchedule(
  supabase: Client,
  projectIds: string[],
): Promise<{ phases: TimelinePhase[]; milestones: TimelineMilestone[]; tasks: TimelineTask[] }> {
  if (projectIds.length === 0) return { phases: [], milestones: [], tasks: [] };
  const [phases, milestones, tasks] = await Promise.all([
    supabase
      .from("project_phases")
      .select("id, project_id, name, status, planned_start, planned_end, actual_start, actual_end, sort_order")
      .in("project_id", projectIds)
      .order("sort_order")
      .order("planned_start", { nullsFirst: false }),
    supabase
      .from("project_milestones")
      .select("id, project_id, phase_id, title, kind, due_date, done_at, description")
      .in("project_id", projectIds)
      .order("due_date"),
    supabase
      .from("tasks")
      .select("id, project_id, title, status, start_date, due_date")
      .in("project_id", projectIds)
      .is("archived_at", null)
      .or("start_date.not.is.null,due_date.not.is.null")
      .order("start_date", { nullsFirst: false })
      .order("due_date"),
  ]);
  for (const r of [phases, milestones, tasks]) if (r.error) throw new Error(r.error.message);
  return { phases: phases.data ?? [], milestones: milestones.data ?? [], tasks: tasks.data ?? [] };
}

// v_calendar_items for a date window. An item is in the window when its
// range overlaps it, not just when it starts there.
export async function loadCalendarItems(
  supabase: Client,
  range: { start: string; end: string },
  scope: { orgId?: string | null; projectId?: string | null },
): Promise<CalendarItem[]> {
  let query = supabase
    .from("v_calendar_items")
    .select("*")
    .lte("starts_on", range.end)
    .gte("ends_on", range.start)
    .order("starts_on")
    .limit(2000);
  if (scope.orgId) query = query.eq("org_id", scope.orgId);
  if (scope.projectId) query = query.eq("project_id", scope.projectId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return toCalendarItems(data ?? []);
}
