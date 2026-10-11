import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, KeyValue, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { el } from "@/lib/i18n/el";
import { formatDate } from "@/lib/format";
import { loadPlannerPeople } from "@/lib/planner/queries";
import { TaskFields } from "@/components/planner/TaskFormModal";
import { ConfirmSubmit } from "@/components/planner/ConfirmSubmit";
import { STATUS_DOT } from "@/components/planner/labels";
import { plannerContext } from "../../context";
import { deleteTask, setTaskArchived, updateTask } from "../../actions";
import { ActionForm } from "@/components/ActionForm";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await plannerContext({});
  const { supabase, caps } = ctx;

  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (!task) notFound();

  const [people, { data: milestones }] = await Promise.all([
    loadPlannerPeople(supabase, task.project_id),
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
    <div className="flex flex-col gap-10">
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
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className={overdue ? "num text-negative" : "num"}>
                  {el.planner.task.due}: {formatDate(task.due_date)}
                </span>
                {overdue && <Badge tone="negative">{el.planner.task.overdue}</Badge>}
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

      <section className="flex max-w-3xl flex-col gap-4">
        {canWrite ? (
          <ActionForm action={updateTask.bind(null, id)} className="flex flex-col gap-4">
            <TaskFields
              initial={task}
              projects={projectOptions}
              people={people.map((p) => ({ id: p.user_id, label: p.label }))}
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
                <p className="text-body whitespace-pre-wrap text-ink">{task.description}</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
