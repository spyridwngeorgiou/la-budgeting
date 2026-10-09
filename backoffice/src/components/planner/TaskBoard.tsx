"use client";

import Link from "next/link";
import { startTransition, useOptimistic, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ListChecks, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { TASK_STATUS, type TaskStatus } from "@/lib/domain/enums";
import { dayMonthLabel } from "@/lib/dates";
import { keyAtEnd, planMove, type Keyed } from "@/lib/planner/sortKey";
import type { BoardTask, PlannerPerson } from "@/lib/planner/queries";
import { PRIORITY_TONE, STATUS_DOT, initials } from "./labels";

type MoveResult = { ok: true } | { ok: false; error: string };

export interface TaskBoardProps {
  tasks: BoardTask[];
  people: PlannerPerson[];
  // project id -> label; shown on cards only when the board spans projects.
  projectLabels?: Record<string, string>;
  canWrite: boolean;
  todayIso: string;
  // Detail page base, e.g. "/planner/task" -> /planner/task/<id>. The partner
  // space passes its own.
  taskHref: string;
  moveAction: (taskId: string, status: TaskStatus, orderedIds: string[]) => Promise<MoveResult>;
  setStatusAction: (taskId: string, status: TaskStatus) => Promise<MoveResult>;
}

type OptimisticUpdate = { id: string; status?: TaskStatus; sort_key: number }[];

const COL_PREFIX = "col:";

function byKey(a: BoardTask, b: BoardTask) {
  return a.sort_key - b.sort_key;
}

// Kanban over the five task statuses. Drops apply on the current frame via
// useOptimistic and are confirmed by moveAction; on phones one column shows
// at a time and each card gets a «Μετακίνηση σε…» select instead of drag.
export function TaskBoard({
  tasks,
  people,
  projectLabels,
  canWrite,
  todayIso,
  taskHref,
  moveAction,
  setStatusAction,
}: TaskBoardProps) {
  const [optimisticTasks, applyUpdate] = useOptimistic(tasks, (current: BoardTask[], updates: OptimisticUpdate) => {
    const byId = new Map(updates.map((u) => [u.id, u]));
    return current.map((t) => {
      const u = byId.get(t.id);
      return u ? { ...t, status: u.status ?? t.status, sort_key: u.sort_key } : t;
    });
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>("todo");
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so tapping the title link
    // still navigates.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = Object.fromEntries(
    TASK_STATUS.map((s) => [s, optimisticTasks.filter((t) => t.status === s).sort(byKey)]),
  ) as Record<TaskStatus, BoardTask[]>;
  const peopleById = new Map(people.map((p) => [p.user_id, p.label]));
  const activeTask = activeId ? optimisticTasks.find((t) => t.id === activeId) : undefined;

  function commit(updates: OptimisticUpdate, run: () => Promise<MoveResult>) {
    setError(null);
    startTransition(async () => {
      applyUpdate(updates);
      const result = await run();
      if (!result.ok) setError(result.error);
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const task = optimisticTasks.find((t) => t.id === active.id);
    if (!task) return;

    const overId = String(over.id);
    const overTask = overId.startsWith(COL_PREFIX) ? undefined : optimisticTasks.find((t) => t.id === overId);
    const target = (overTask?.status ?? overId.slice(COL_PREFIX.length)) as TaskStatus;
    if (!TASK_STATUS.includes(target)) return;

    let ordered: BoardTask[];
    if (target === task.status) {
      const col = columns[target];
      const from = col.findIndex((t) => t.id === task.id);
      const to = overTask ? col.findIndex((t) => t.id === overTask.id) : col.length - 1;
      if (from === to) return;
      ordered = arrayMove(col, from, to);
    } else {
      const col = columns[target];
      const at = overTask ? col.findIndex((t) => t.id === overTask.id) : col.length;
      ordered = [...col.slice(0, at), task, ...col.slice(at)];
    }

    const plan = planMove(
      ordered.map((t): Keyed => ({ id: t.id, sort_key: t.sort_key })),
      task.id,
    );
    const updates: OptimisticUpdate = plan.rebalanced
      ? plan.rebalanced.map((r) => ({ id: r.id, sort_key: r.sort_key, status: target }))
      : [{ id: task.id, status: target, sort_key: plan.sortKey }];
    commit(updates, () =>
      moveAction(
        task.id,
        target,
        ordered.map((t) => t.id),
      ),
    );
  }

  function moveViaSelect(task: BoardTask, status: TaskStatus) {
    if (status === task.status) return;
    commit([{ id: task.id, status, sort_key: keyAtEnd(columns[status]) }], () => setStatusAction(task.id, status));
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div role="alert" className="rounded-md border border-red-ink/30 bg-red-bg px-3 py-2 text-sm text-red-ink">
          {error}
        </div>
      )}

      {/* Phones: pick the column, one at a time. */}
      <div className="flex gap-1 overflow-x-auto md:hidden" role="tablist">
        {TASK_STATUS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={mobileStatus === s}
            onClick={() => setMobileStatus(s)}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
              mobileStatus === s ? "bg-sage font-medium text-sage-ink" : "border border-line bg-surface text-ink-muted"
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
            {el.planner.status[s]}
            <span className="text-xs text-ink-faint">{columns[s].length}</span>
          </button>
        ))}
      </div>

      <DndContext
        id="planner-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="md:grid md:grid-cols-[repeat(5,minmax(13rem,1fr))] md:gap-3 md:overflow-x-auto md:pb-2">
          {TASK_STATUS.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={columns[status]}
              hiddenOnMobile={status !== mobileStatus}
            >
              {columns[status].map((task) => (
                <SortableCard key={task.id} task={task} disabled={!canWrite}>
                  <CardBody
                    task={task}
                    assignee={task.assignee_id ? peopleById.get(task.assignee_id) : undefined}
                    projectLabel={projectLabels?.[task.project_id]}
                    todayIso={todayIso}
                    href={`${taskHref}/${task.id}`}
                    moveSelect={
                      canWrite ? (
                        <select
                          aria-label={el.planner.moveTo}
                          value=""
                          onChange={(e) => moveViaSelect(task, e.target.value as TaskStatus)}
                          onKeyDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-muted md:hidden"
                        >
                          <option value="" disabled>
                            {el.planner.moveTo}
                          </option>
                          {TASK_STATUS.filter((s) => s !== task.status).map((s) => (
                            <option key={s} value={s}>
                              {el.planner.status[s]}
                            </option>
                          ))}
                        </select>
                      ) : null
                    }
                  />
                </SortableCard>
              ))}
            </Column>
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="rotate-1 rounded-md border border-line-strong bg-surface p-2.5 shadow-lg">
              <CardBody
                task={activeTask}
                assignee={activeTask.assignee_id ? peopleById.get(activeTask.assignee_id) : undefined}
                projectLabel={projectLabels?.[activeTask.project_id]}
                todayIso={todayIso}
                href={`${taskHref}/${activeTask.id}`}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({
  status,
  tasks,
  hiddenOnMobile,
  children,
}: {
  status: TaskStatus;
  tasks: BoardTask[];
  hiddenOnMobile: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COL_PREFIX}${status}` });
  return (
    <section
      ref={setNodeRef}
      aria-label={el.planner.status[status]}
      className={`${hiddenOnMobile ? "hidden" : "flex"} min-h-40 flex-col gap-2 rounded-lg border p-2 md:flex ${
        isOver ? "border-sage-strong bg-sage/30" : "border-line bg-bg"
      }`}
    >
      <header className="hidden items-center justify-between px-1 md:flex">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
          {el.planner.status[status]}
        </span>
        <span className="text-xs text-ink-faint">{tasks.length}</span>
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-2">{children}</ul>
      </SortableContext>
      {tasks.length === 0 && <p className="px-1 py-4 text-center text-xs text-ink-faint">{el.planner.emptyColumn}</p>}
    </section>
  );
}

function SortableCard({ task, disabled, children }: { task: BoardTask; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border border-line bg-surface p-2.5 ${
        disabled ? "" : "cursor-grab touch-manipulation active:cursor-grabbing"
      } ${isDragging ? "opacity-40" : ""}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </li>
  );
}

function CardBody({
  task,
  assignee,
  projectLabel,
  todayIso,
  href,
  moveSelect,
}: {
  task: BoardTask;
  assignee?: string;
  projectLabel?: string;
  todayIso: string;
  href: string;
  moveSelect?: React.ReactNode;
}) {
  const overdue = task.due_date != null && task.due_date < todayIso && task.status !== "done";
  const tone = PRIORITY_TONE[task.priority];
  return (
    <div className="flex flex-col gap-1.5">
      {projectLabel && <span className="truncate text-[11px] text-ink-faint">{projectLabel}</span>}
      {/* Keys pressed on the link or select must not reach the card's
          keyboard-drag listener (Enter/Space would start a drag). */}
      <Link
        href={href}
        onKeyDown={(e) => e.stopPropagation()}
        className="text-sm leading-snug text-ink hover:underline"
      >
        {task.title}
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        {tone && <Badge tone={tone}>{el.planner.priority[task.priority]}</Badge>}
        {task.due_date && (
          <span className={overdue ? "font-medium text-red-ink" : ""} title={overdue ? el.planner.task.overdue : undefined}>
            {dayMonthLabel(task.due_date)}
          </span>
        )}
        {task.checklist_total > 0 && (
          <span className={task.checklist_done === task.checklist_total ? "text-sage-ink" : ""}>
            <ListChecks className="mr-0.5 inline h-3.5 w-3.5" aria-hidden />
            {task.checklist_done}/{task.checklist_total}
          </span>
        )}
        {task.comment_count > 0 && (
          <span>
            <MessageSquare className="mr-0.5 inline h-3.5 w-3.5" aria-hidden />
            {task.comment_count}
          </span>
        )}
        {assignee && (
          <span
            title={assignee}
            className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sage px-1 text-[10px] font-medium text-sage-ink"
          >
            {initials(assignee)}
          </span>
        )}
      </div>
      {moveSelect}
    </div>
  );
}
