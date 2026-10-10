import { GlancePanel, MetaList, PageHeader, Stat, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { projects as t } from "@/lib/i18n/v2/projects";
import type { ProjectStatus } from "@/lib/domain/enums";
import { updateProject } from "@/app/(app)/projects/actions";
import { saveProjectBudget, syncLeaseScheduleAction } from "@/app/(app)/projects/[id]/finance-actions";
import { BudgetFields, ProjectFields } from "../forms/fields";
import { money0, percent, times } from "../format";
import { projectTabs } from "../tabs";
import type { ProjectCore } from "../data";
import { HeaderActions } from "./HeaderActions";

// The top of every project tab: eyebrow «ΕΡΓΟ · Q004 · Φιλοξενία», the
// name, short facts, two actions + «⋯», then «Με μια ματιά» -- six figures
// on the navy panel -- and the five tabs. Rendered by
// /projects/[id]/layout.tsx, so it stays put while the tabs change.
export function ProjectHeader({ core }: { core: ProjectCore }) {
  const { id, rollup, project, budget, inputs, base } = core;
  const lease = inputs.lease;
  const isPartner = core.role === "partner";
  const businessLine = rollup.business_line ? el.reports.businessLines[rollup.business_line] : null;

  const lines = budget?.budget_lines ?? [];
  const spent = Number(rollup.capex_paid ?? 0) + Number(rollup.capex_committed ?? 0);
  const remaining = Number(rollup.remaining_budget ?? 0);
  const contingency = Number(budget?.contingency_pct ?? 0);
  const kpis = base?.result.cashflow?.kpis ?? null;
  const covenant = Number(base?.scenario.dscr_covenant_min ?? 1.2);
  const next = core.nextDates[0] ?? null;

  const stats = [
    {
      label: t.glance.investment,
      value: core.hasBudget ? money0(rollup.total_budget) : t.glance.none,
      sub: core.hasBudget ? (contingency > 0 ? t.glance.contingency(`${contingency}%`) : null) : t.glance.noBudget,
    },
    {
      label: t.glance.spent,
      value: money0(spent),
      sub: core.hasBudget
        ? remaining < 0
          ? `${t.glance.over} ${money0(-remaining)}`
          : `${t.glance.remaining} ${money0(remaining)}`
        : null,
    },
    {
      label: t.glance.funding,
      value: money0(core.loansTotal + core.capitalTotal),
      sub: t.glance.fundingSub(money0(core.loansTotal), money0(core.capitalTotal)),
    },
    {
      label: t.glance.returns,
      value: `${t.glance.irr} ${percent(core.development.irr)}`,
      sub: kpis ? `${t.glance.npv} ${money0(kpis.npv)}` : null,
    },
    {
      label: t.glance.dscr,
      value: times(kpis?.minDscr?.value ?? null),
      sub: kpis?.minDscr
        ? kpis.minDscr.value < covenant
          ? `${t.glance.breach} (${times(covenant)})`
          : t.glance.covenant(times(covenant).replace("×", ""))
        : null,
    },
    {
      label: t.glance.next,
      value: next ? formatDate(next.date) : t.glance.none,
      sub: next ? next.title : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={[t.eyebrow, rollup.code, businessLine].filter(Boolean).join(" · ")}
        title={rollup.display_name}
        meta={
          <MetaList
            items={[
              rollup.status ? el.project.statusValues[rollup.status as ProjectStatus] : null,
              project?.units ? `${project.units} ${t.header.units}` : null,
              lease ? t.header.lease(lease.term_years) : null,
              project?.opening_date ? `${t.header.opening} ${formatDate(project.opening_date)}` : null,
              project?.phase,
            ]}
          />
        }
        actions={
          isPartner ? null : (
            <HeaderActions
              projectId={id}
              canEdit={core.canEdit}
              editAction={updateProject.bind(null, id)}
              editFields={
                <ProjectFields
                  initial={{ ...project, code: rollup.code ?? undefined, display_name: rollup.display_name ?? undefined, status: rollup.status ?? undefined }}
                />
              }
              budgetAction={saveProjectBudget.bind(null, id)}
              budgetFields={
                <BudgetFields
                  initial={
                    budget
                      ? { contingency_pct: contingency, lines: Object.fromEntries(lines.map((l) => [l.line_code, Number(l.amount)])) }
                      : undefined
                  }
                />
              }
              syncLease={lease?.kind === "indexed_rent" ? syncLeaseScheduleAction.bind(null, lease.id) : null}
            />
          )
        }
      />

      {!isPartner && (
        <GlancePanel className="lg:p-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 xl:grid-cols-6">
            {stats.map((s) => (
              <Stat key={s.label} onPanel label={s.label} value={s.value} sub={s.sub} />
            ))}
          </div>
        </GlancePanel>
      )}

      <Tabs tabs={projectTabs(id, core.role)} label={t.tabs.label} />
    </div>
  );
}
