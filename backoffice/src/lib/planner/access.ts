import type { OrgRole, ProjectRole } from "@/lib/domain/enums";

// What the planner UI should offer a given viewer. RLS (0040's
// planner_can_read / planner_can_write) is the real boundary; this only
// mirrors it so nobody is shown a button that would fail. Keep the two in
// step -- the vitest cases spell out the same matrix as the pgTAP ones.
//
// A partner (0037: project_members, never org_members) has no org role,
// only a role inside the project; guests only read.

export type PlannerViewer =
  | { kind: "member"; role: OrgRole }
  | { kind: "partner"; projectRole: ProjectRole };

export interface PlannerCapabilities {
  // Create tasks, edit them, move cards.
  canWriteTasks: boolean;
  // Milestones -- the schedule skeleton.
  canEditSchedule: boolean;
  // Delete tasks/milestones, and move a task to another project.
  canDelete: boolean;
  // Payments, VAT, leases, loans on the calendar.
  canSeeFinancial: boolean;
}

const EDITOR_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(["editor", "admin", "owner"]);

export function plannerCapabilities(viewer: PlannerViewer): PlannerCapabilities {
  if (viewer.kind === "partner") {
    const canWriteTasks = viewer.projectRole !== "guest";
    return { canWriteTasks, canEditSchedule: false, canDelete: false, canSeeFinancial: false };
  }
  const editor = EDITOR_ROLES.has(viewer.role);
  return { canWriteTasks: editor, canEditSchedule: editor, canDelete: editor, canSeeFinancial: true };
}
