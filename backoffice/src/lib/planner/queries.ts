import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { TaskPriority, TaskStatus } from "@/lib/domain/enums";
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
  // Set by the tasks_track_completion trigger (0040); orders «Ολοκληρώθηκε».
  completed_at: string | null;
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
      "id, project_id, title, status, priority, assignee_id, start_date, due_date, sort_key, archived_at, completed_at",
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
  return (data ?? []).map((t) => ({
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
    completed_at: t.completed_at,
  }));
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
