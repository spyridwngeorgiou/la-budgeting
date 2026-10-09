import Link from "next/link";
import { el } from "@/lib/i18n/el";
import { formatDate } from "@/lib/format";
import { shortMonthLabel } from "@/lib/planner/dates";
import { computeTimeline, type TimelineBar } from "@/lib/planner/timeline";
import type { TimelineMilestone, TimelinePhase, TimelineTask } from "@/lib/planner/queries";
import { STATUS_BAR } from "./labels";

export interface TimelineGroup {
  project: { id: string; label: string };
  phases: TimelinePhase[];
  milestones: TimelineMilestone[];
  tasks: TimelineTask[];
}

// Custom Gantt: one shared axis (computeTimeline) for every project shown,
// rows are absolutely positioned bars in percent. Server-rendered -- no
// client JS -- and wide enough to scroll sideways on a phone rather than
// squash. Edit controls come in through the render props so the partner
// space can show the same chart read-only.
export function Timeline({
  groups,
  today,
  taskHref,
  renderPhaseActions,
  renderMilestoneActions,
}: {
  groups: TimelineGroup[];
  today: string;
  taskHref: string;
  renderPhaseActions?: (phase: TimelinePhase) => React.ReactNode;
  renderMilestoneActions?: (milestone: TimelineMilestone) => React.ReactNode;
}) {
  const inputs = groups.flatMap((g) => [
    ...g.phases.flatMap((p) => [
      { id: `pp:${p.id}`, start: p.planned_start, end: p.planned_end },
      { id: `pa:${p.id}`, start: p.actual_start, end: p.actual_end },
    ]),
    ...g.milestones.map((m) => ({ id: `m:${m.id}`, start: m.due_date, end: m.due_date })),
    ...g.tasks.map((t) => ({ id: `t:${t.id}`, start: t.start_date, end: t.due_date })),
  ]);
  const tl = computeTimeline(inputs, { today });
  const hasAnything = groups.some((g) => g.phases.length + g.milestones.length + g.tasks.length > 0);

  if (!hasAnything) {
    return (
      <p className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-faint">
        {el.planner.timeline.empty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <div className="relative min-w-[760px]">
        {/* Month rules and today, drawn once over every row. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-56" aria-hidden>
          {tl.months.map((m) => (
            <div key={m.key} className="absolute inset-y-0 border-l border-line/70" style={{ left: `${m.leftPct}%` }} />
          ))}
          {tl.todayPct != null && (
            <div className="absolute inset-y-0 w-px bg-red-ink/60" style={{ left: `${tl.todayPct}%` }} />
          )}
        </div>

        <div className="sticky top-0 grid grid-cols-[14rem_1fr] border-b border-line bg-surface text-xs text-ink-muted">
          <div className="px-3 py-2" />
          <div className="relative h-8">
            {tl.months.map((m) => (
              <span
                key={m.key}
                className="absolute top-2 truncate pl-1.5 capitalize"
                style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
              >
                {shortMonthLabel(m.key)}
                {(m.key.endsWith("-01") || m.key === tl.months[0].key) && ` ${m.key.slice(0, 4)}`}
              </span>
            ))}
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.project.id} className="border-b border-line last:border-b-0">
            {groups.length > 1 && (
              <div className="bg-bg/60 px-3 py-1.5 text-xs font-medium text-ink">{g.project.label}</div>
            )}
            {g.phases.map((p) => (
              <Row
                key={p.id}
                label={<span className="font-medium">{p.name}</span>}
                meta={el.planner.phaseStatus[p.status]}
                actions={renderPhaseActions?.(p)}
              >
                <Bar bar={tl.bars[`pp:${p.id}`]} className="border border-sage-strong bg-sage/40" />
                <Bar bar={tl.bars[`pa:${p.id}`]} className="bg-sage-ink/70" thin />
              </Row>
            ))}
            {g.milestones.map((m) => (
              <Row
                key={m.id}
                label={<span className={m.done_at ? "text-ink-faint line-through" : ""}>{m.title}</span>}
                meta={`${el.planner.milestoneKind[m.kind]} · ${formatDate(m.due_date)}`}
                actions={renderMilestoneActions?.(m)}
              >
                <Diamond bar={tl.bars[`m:${m.id}`]} done={!!m.done_at} />
              </Row>
            ))}
            {g.tasks.map((t) => (
              <Row
                key={t.id}
                label={
                  <Link href={`${taskHref}/${t.id}`} className="hover:underline">
                    {t.title}
                  </Link>
                }
                meta={el.planner.status[t.status]}
              >
                {tl.bars[`t:${t.id}`]?.isPoint ? (
                  <Diamond bar={tl.bars[`t:${t.id}`]} done={t.status === "done"} small />
                ) : (
                  <Bar bar={tl.bars[`t:${t.id}`]} className={STATUS_BAR[t.status]} />
                )}
              </Row>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  label,
  meta,
  actions,
  children,
}: {
  label: React.ReactNode;
  meta?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[14rem_1fr] border-t border-line/50 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink">{label}</div>
          {meta && <div className="truncate text-[11px] text-ink-faint">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function Bar({ bar, className, thin }: { bar?: TimelineBar; className: string; thin?: boolean }) {
  if (!bar) return null;
  return (
    <div
      className={`absolute rounded-sm ${thin ? "top-[45%] h-1.5" : "top-1/2 h-4 -translate-y-1/2"} ${
        bar.startsBefore ? "rounded-l-none" : ""
      } ${bar.endsAfter ? "rounded-r-none" : ""} ${className}`}
      style={{ left: `${bar.leftPct}%`, width: `max(${bar.widthPct}%, 3px)` }}
    />
  );
}

function Diamond({ bar, done, small }: { bar?: TimelineBar; done: boolean; small?: boolean }) {
  if (!bar) return null;
  return (
    <div
      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 ${small ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} ${
        done ? "bg-sage-ink" : "border-2 border-sage-ink bg-surface"
      }`}
      style={{ left: `${bar.leftPct + bar.widthPct / 2}%` }}
    />
  );
}
