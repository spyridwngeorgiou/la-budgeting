import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { formatDate } from "@/lib/format";
import { loadPlannerPeople } from "@/lib/planner/queries";
import { TaskFields } from "@/components/planner/TaskFormModal";
import { TaskChecklist } from "@/components/planner/TaskChecklist";
import { TaskComments } from "@/components/planner/TaskComments";
import { ConfirmSubmit } from "@/components/planner/ConfirmSubmit";
import { STATUS_DOT } from "@/components/planner/labels";
import { plannerContext } from "../../context";
import {
  addChecklistItem,
  addComment,
  deleteChecklistItem,
  deleteComment,
  deleteTask,
  setTaskArchived,
  toggleChecklistItem,
  updateTask,
} from "../../actions";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await plannerContext({});
  const { supabase, caps } = ctx;

  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (!task) notFound();

  const [people, { data: checklist }, { data: comments }, { data: phases }, { data: milestones }] = await Promise.all([
    loadPlannerPeople(supabase, task.project_id),
    supabase.from("task_checklist_items").select("id, body, done").eq("task_id", id).order("sort_order"),
    supabase
      .from("task_comments")
      .select("id, author_id, body, created_at")
      .eq("task_id", id)
      .order("created_at"),
    supabase.from("project_phases").select("id, name").eq("project_id", task.project_id).order("sort_order"),
    supabase.from("project_milestones").select("id, title").eq("project_id", task.project_id).order("due_date"),
  ]);

  const peopleById = new Map(people.map((p) => [p.user_id, p.label]));
  const projectLabel = ctx.projectLabels[task.project_id];
  const overdue = task.due_date != null && task.due_date < ctx.today && task.status !== "done";
  const canWrite = caps.canWriteTasks && !task.archived_at;
  // A task reached by URL from another of the user's orgs: never offer the
  // current org's projects as move targets for it.
  const projectOptions = projectLabel
    ? ctx.projects.map((p) => ({ id: p.id, label: p.display_name }))
    : [{ id: task.project_id, label: "—" }];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/planner?project=${task.project_id}`} className="text-xs text-ink-muted hover:underline">
            {el.planner.task.back}
          </Link>
          <h2 className="text-lg font-semibold text-ink">{task.title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[task.status]}`} />
              {el.planner.status[task.status]}
            </span>
            {projectLabel && (
              <Link href={`/projects/${task.project_id}`} className="hover:underline">
                {projectLabel}
              </Link>
            )}
            {task.due_date && (
              <span className={overdue ? "font-medium text-red-ink" : ""}>
                {el.planner.task.due}: {formatDate(task.due_date)}
                {overdue && ` · ${el.planner.task.overdue}`}
              </span>
            )}
            {task.completed_at && (
              <span>
                {el.planner.task.completed} {formatDate(task.completed_at)}
              </span>
            )}
            {task.archived_at && <Badge tone="amber">{el.planner.task.archived}</Badge>}
            {task.source_note_id && <Badge>{el.planner.task.fromNote}</Badge>}
          </div>
        </div>
        {caps.canWriteTasks && (
          <div className="flex items-center gap-2">
            <form action={setTaskArchived.bind(null, id, !task.archived_at)}>
              <Button type="submit" variant="secondary">
                {task.archived_at ? el.planner.task.unarchive : el.planner.task.archive}
              </Button>
            </form>
            {caps.canDelete && (
              <ConfirmSubmit action={deleteTask.bind(null, id, `/planner?project=${task.project_id}`)} confirmText={el.planner.task.deleteConfirm}>
                {el.common.delete}
              </ConfirmSubmit>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          {canWrite ? (
            <form action={updateTask.bind(null, id)} className="flex flex-col gap-3">
              <TaskFields
                initial={task}
                projects={projectOptions}
                people={people.map((p) => ({ id: p.user_id, label: p.label }))}
                phases={(phases ?? []).map((p) => ({ id: p.id, label: p.name }))}
                milestones={(milestones ?? []).map((m) => ({ id: m.id, label: m.title }))}
                canMoveProject={caps.canDelete}
              />
              <div className="flex justify-end">
                <SubmitButton>{el.common.save}</SubmitButton>
              </div>
            </form>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">{el.planner.task.priority}</dt>
              <dd>{el.planner.priority[task.priority]}</dd>
              <dt className="text-ink-muted">{el.planner.assignee}</dt>
              <dd>{task.assignee_id ? (peopleById.get(task.assignee_id) ?? "—") : el.planner.unassigned}</dd>
              <dt className="text-ink-muted">{el.planner.task.start}</dt>
              <dd>{formatDate(task.start_date) || "—"}</dd>
              <dt className="text-ink-muted">{el.planner.task.due}</dt>
              <dd>{formatDate(task.due_date) || "—"}</dd>
              {task.description && (
                <>
                  <dt className="text-ink-muted">{el.planner.task.description}</dt>
                  <dd className="whitespace-pre-wrap">{task.description}</dd>
                </>
              )}
            </dl>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <h3 className="mb-2 text-sm font-medium text-ink">{el.planner.task.checklist}</h3>
            <TaskChecklist
              items={checklist ?? []}
              canWrite={canWrite}
              addAction={addChecklistItem.bind(null, id)}
              toggleAction={toggleChecklistItem}
              deleteAction={deleteChecklistItem}
            />
          </Card>
          <Card>
            <h3 className="mb-2 text-sm font-medium text-ink">{el.planner.task.comments}</h3>
            <TaskComments
              comments={(comments ?? []).map((c) => ({
                id: c.id,
                author: peopleById.get(c.author_id) ?? "—",
                body: c.body,
                created_at: c.created_at,
                mine: c.author_id === ctx.userId,
              }))}
              canWrite={caps.canWriteTasks}
              addAction={addComment.bind(null, id)}
              deleteAction={deleteComment}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
