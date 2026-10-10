import Link from "next/link";
import { Amount, DataTable, KeyValue, SectionHeader, Worklist, WorklistItem, type Severity } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { projects as t } from "@/lib/i18n/v2/projects";
import type { ProjectNoteSeverity, TaskPriority, TxStatus } from "@/lib/domain/enums";
import { resolveProjectNote, saveProjectNote } from "@/app/(app)/projects/actions";
import { NoteFields, NOTE_SEVERITY_LABELS } from "./forms/fields";
import { DrawerButton } from "./DrawerButton";
import { ActionButton } from "./ActionButton";
import { requireTab, type DateItem } from "./data";

// Επισκόπηση: what needs a person (open risks, urgent and overdue work,
// overdue payments), the client contract, the last five movements and the
// next five dates. Everything else has its own tab.

const NOTE_SEVERITY: Record<ProjectNoteSeverity, Severity> = { urgent: "urgent", watch: "attention", info: "info" };
const RANK: Record<Severity, number> = { urgent: 0, attention: 1, info: 2 };

export async function OverviewTab({ id }: { id: string }) {
  const core = await requireTab(id, "overview");
  const { supabase, today, project } = core;

  const [{ data: notes }, { data: tasks }, { count: overdueTx }, { data: recent }, { data: income }] = await Promise.all([
    supabase
      .from("project_notes")
      .select("id, kind, severity, body, exposure_amount, due_date")
      .eq("project_id", id)
      .is("resolved_at", null)
      .order("sort_order"),
    supabase
      .from("tasks")
      .select("id, title, priority, due_date")
      .eq("project_id", id)
      .is("archived_at", null)
      .neq("status", "done")
      .or(`priority.in.(urgent,high),due_date.lt.${today}`)
      .order("due_date", { nullsFirst: false })
      .limit(20),
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .in("status", ["pending", "scheduled"])
      .lt("due_date", today),
    supabase
      .from("transactions")
      .select("id, tx_date, description, counterparty_name, direction, gross_amount, status")
      .eq("project_id", id)
      .neq("status", "cancelled")
      .order("tx_date", { ascending: false })
      .limit(5),
    project?.contract_value != null
      ? supabase.from("transactions").select("gross_amount").eq("project_id", id).eq("direction", "income").eq("status", "paid")
      : Promise.resolve({ data: [] as { gross_amount: number | null }[] }),
  ]);

  const taskSeverity = (task: { priority: TaskPriority; due_date: string | null }): Severity =>
    task.priority === "urgent" || (task.due_date !== null && task.due_date < today) ? "urgent" : "attention";
  const sortedNotes = [...(notes ?? [])].sort((a, b) => RANK[NOTE_SEVERITY[a.severity]] - RANK[NOTE_SEVERITY[b.severity]]);
  const overdueTasks = (tasks ?? []).filter((x) => x.due_date !== null && x.due_date < today).length;
  const nothing = sortedNotes.length === 0 && (tasks ?? []).length === 0 && !overdueTx;

  const contract = project?.contract_value != null ? Number(project.contract_value) : null;
  const billed = (income ?? []).reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-2">
      <section className="flex flex-col gap-3 lg:col-span-2">
        <SectionHeader
          title={t.overview.risks}
          actions={
            core.canEdit && (
              <DrawerButton label={t.overview.addNote} title={t.overview.noteTitle} action={saveProjectNote.bind(null, id, null)}>
                <NoteFields />
              </DrawerButton>
            )
          }
        />
        {nothing ? (
          <p className="text-sm text-muted">{t.overview.noRisks}</p>
        ) : (
          <Worklist label={t.overview.risks}>
            {!!overdueTx && (
              <WorklistItem
                severity="urgent"
                title={t.overview.overdueTx(overdueTx)}
                href={`/transactions?project_id=${id}&status=pending`}
              />
            )}
            {overdueTasks > 0 && <WorklistItem severity="urgent" title={t.overview.overdueTasks(overdueTasks)} href={`/planner?project=${id}`} />}
            {sortedNotes.map((n) => (
              <WorklistItem
                key={n.id}
                severity={NOTE_SEVERITY[n.severity]}
                title={
                  core.canEdit ? (
                    <DrawerButton
                      asLink
                      label={n.body}
                      title={t.overview.editNote}
                      eyebrow={NOTE_SEVERITY_LABELS[n.severity]}
                      action={saveProjectNote.bind(null, id, n.id)}
                    >
                      <NoteFields initial={n} />
                    </DrawerButton>
                  ) : (
                    n.body
                  )
                }
                meta={[
                  n.kind === "risk" ? "Ρίσκο" : null,
                  n.exposure_amount ? `${t.overview.exposure} ${formatMoney(n.exposure_amount)}` : null,
                  n.due_date ? `${t.overview.due} ${formatDate(n.due_date)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                amount={
                  core.canEdit ? <ActionButton action={resolveProjectNote.bind(null, id, n.id)}>{t.overview.resolve}</ActionButton> : undefined
                }
              />
            ))}
            {(tasks ?? []).map((task) => (
              <WorklistItem
                key={task.id}
                severity={taskSeverity(task)}
                title={task.title}
                meta={[el.planner.priority[task.priority], task.due_date ? `${t.overview.due} ${formatDate(task.due_date)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
                href={`/planner/task/${task.id}`}
              />
            ))}
          </Worklist>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t.overview.next} />
        <DataTable<DateItem>
          rows={core.nextDates}
          rowKey={(r) => r.key}
          empty={t.overview.noNext}
          columns={[
            { key: "date", header: t.overview.date, cell: (r) => formatDate(r.date), className: "whitespace-nowrap" },
            { key: "what", header: t.overview.what, primary: true, cell: (r) => r.title },
            { key: "kind", header: "", cell: (r) => <span className="text-small text-muted">{r.kind}</span> },
            {
              key: "amount",
              header: t.overview.amount,
              numeric: true,
              cell: (r) => (r.amount == null ? "" : <Amount value={r.direction === "expense" ? -r.amount : r.amount} format={formatMoney} />),
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader
          title={t.overview.recent}
          actions={
            <Link href={`/transactions?project_id=${id}`} className="text-small text-ink underline-offset-4 hover:underline">
              {t.overview.allTransactions} →
            </Link>
          }
        />
        <DataTable
          rows={recent ?? []}
          rowKey={(r) => r.id}
          columns={[
            { key: "date", header: t.overview.date, cell: (r) => formatDate(r.tx_date), className: "whitespace-nowrap" },
            { key: "what", header: t.overview.what, primary: true, cell: (r) => r.description || r.counterparty_name || "—" },
            { key: "status", header: t.overview.status, cell: (r) => el.transaction[r.status as TxStatus] ?? r.status },
            {
              key: "amount",
              header: t.overview.amount,
              numeric: true,
              cell: (r) => <Amount value={r.direction === "expense" ? -Number(r.gross_amount) : Number(r.gross_amount)} format={formatMoney} />,
            },
          ]}
        />
      </section>

      {contract !== null && (
        <section className="flex flex-col gap-3">
          <SectionHeader title={t.overview.contract} />
          <KeyValue
            items={[
              {
                label: t.overview.contractValue,
                value: (
                  <>
                    {formatMoney(contract)}
                    {project?.contract_signed_date && (
                      <span className="block text-small text-muted">
                        {t.overview.signed} {formatDate(project.contract_signed_date)}
                      </span>
                    )}
                  </>
                ),
                numeric: true,
              },
              {
                label: <Link href={`/transactions?project_id=${id}&direction=income&status=paid`}>{t.overview.billed}</Link>,
                value: formatMoney(billed),
                numeric: true,
              },
              {
                label: t.overview.toBill,
                value: <Amount value={contract - billed} format={formatMoney} signed={false} tone={contract - billed < 0 ? "negative" : undefined} />,
                numeric: true,
              },
            ]}
          />
        </section>
      )}
    </div>
  );
}
