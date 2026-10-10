import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, KeyValue, PageHeader, SectionHeader } from "@/components/ui";
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
import { ActionForm } from "@/components/ActionForm";

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
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={`/planner?project=${task.project_id}`} className="inline-flex min-h-8 items-center hover:text-ink hover:underline">
            {el.planner.task.back}
          </Link>
        }
        title={task.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[task.status]}`} />
              {el.planner.status[task.status]}
            </span>
            {projectLabel && (
              <Link href={`/projects/${task.project_id}`} className="hover:text-ink hover:underline">
                {projectLabel}
              </Link>
            )}
            {task.due_date && (
              <span className={overdue ? "border-l-2 border-negative pl-2 font-medium text-negative" : "num"}>
                {el.planner.task.due}: {formatDate(task.due_date)}
                {overdue && ` · ${el.planner.task.overdue}`}
              </span>
            )}
            {task.completed_at && (
              <span>
                {el.planner.task.completed} {formatDate(task.completed_at)}
              </span>
            )}
            {task.archived_at && <Badge tone="warning">{el.planner.task.archived}</Badge>}
            {task.source_note_id && <Badge>{el.planner.task.fromNote}</Badge>}
          </span>
        }
        actions={
          caps.canWriteTasks && (
            <>
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
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4">
          {canWrite ? (
            <ActionForm action={updateTask.bind(null, id)} className="flex flex-col gap-4">
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
            </ActionForm>
          ) : (
            <>
              <KeyValue
                items={[
                  { label: el.planner.task.priority, value: el.planner.priority[task.priority] },
                  {
                    label: el.planner.assignee,
                    value: task.assignee_id ? (peopleById.get(task.assignee_id) ?? "—") : el.planner.unassigned,
                  },
                  { label: el.planner.task.start, value: formatDate(task.start_date) || "—", numeric: true },
                  { label: el.planner.task.due, value: formatDate(task.due_date) || "—", numeric: true },
                ]}
              />
              {task.description && (
                <div className="flex flex-col gap-1">
                  <p className="eyebrow text-muted">{el.planner.task.description}</p>
                  <p className="text-sm whitespace-pre-wrap text-ink">{task.description}</p>
                </div>
              )}
            </>
          )}
        </section>

        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-3">
            <SectionHeader as="h2" title={el.planner.task.checklist} />
            <TaskChecklist
              items={checklist ?? []}
              canWrite={canWrite}
              addAction={addChecklistItem.bind(null, id)}
              toggleAction={toggleChecklistItem}
              deleteAction={deleteChecklistItem}
            />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader as="h2" title={el.planner.task.comments} />
            <TaskComments
              comments={(comments ?? []).map((c) => ({
                id: c.id,
                author: peopleById.get(c.author_id) ?? "—",
                body: c.body,
                created_at: c.created_at,
                mine: c.author_id === ctx.userId,
              }))}
              canWrite={caps.canComment}
              addAction={addComment.bind(null, id)}
              deleteAction={deleteComment}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
