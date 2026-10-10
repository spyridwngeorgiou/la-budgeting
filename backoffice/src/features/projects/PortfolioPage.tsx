import { DataTable, FilterChip, MenuLink, PageHeader, StatusDot, Toolbar } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/supabase/org";
import { formatDate } from "@/lib/format";
import { todayAthens } from "@/lib/dates";
import { withParams } from "@/lib/url";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import { BUSINESS_LINE, type BusinessLine, type ProjectStatus } from "@/lib/domain/enums";
import { createProject } from "@/app/(app)/projects/actions";
import { ProjectFields } from "./forms/fields";
import { DrawerButton } from "./DrawerButton";
import { money0 } from "./format";
import { projectHealth, type Health } from "./health";

const t = projects.portfolio;
type Params = Record<string, string | string[] | undefined>;

// /projects in the new look: every project of the org as one table (cards
// on phones) with its health dot, remaining budget and next date; chips
// filter by business line and keep any other query params.
export async function PortfolioPage({ searchParams }: { searchParams: Params }) {
  const supabase = await createClient();
  const { orgId, role } = await getCurrentMembership(supabase);
  const today = todayAthens();

  const [{ data: rollup }, { data: withoutBudget }, { data: notes }, { data: overdue }, { data: dates }] = await Promise.all([
    supabase.from("v_project_rollup").select("*").eq("org_id", orgId).order("code"),
    supabase.from("v_qc_projects_without_budget").select("project_id").eq("org_id", orgId),
    supabase.from("project_notes").select("project_id, severity").eq("org_id", orgId).is("resolved_at", null),
    supabase
      .from("transactions")
      .select("project_id")
      .eq("org_id", orgId)
      .not("project_id", "is", null)
      .in("status", ["pending", "scheduled"])
      .lt("due_date", today)
      .limit(5000),
    // Ordered by date: the first row per project is its next date.
    supabase
      .from("v_calendar_items")
      .select("project_id, starts_on")
      .eq("org_id", orgId)
      .not("project_id", "is", null)
      .eq("is_done", false)
      .gte("starts_on", today)
      .order("starts_on")
      .limit(2000),
  ]);

  const noBudget = new Set((withoutBudget ?? []).map((r) => r.project_id));
  const tally = (keys: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const urgent = tally((notes ?? []).filter((n) => n.severity === "urgent").map((n) => n.project_id));
  const watch = tally((notes ?? []).filter((n) => n.severity === "watch").map((n) => n.project_id));
  const late = tally((overdue ?? []).map((r) => r.project_id));
  const nextDate = new Map<string, string>();
  for (const d of dates ?? []) if (d.project_id && d.starts_on && !nextDate.has(d.project_id)) nextDate.set(d.project_id, d.starts_on);

  const rows = (rollup ?? [])
    .filter((p): p is typeof p & { project_id: string } => !!p.project_id)
    .map((p) => {
      const hasBudget = !noBudget.has(p.project_id);
      const health: Health = projectHealth({
        hasBudget,
        remaining: Number(p.remaining_budget ?? 0),
        urgentNotes: urgent.get(p.project_id) ?? 0,
        watchNotes: watch.get(p.project_id) ?? 0,
        overduePayments: late.get(p.project_id) ?? 0,
      });
      return { ...p, hasBudget, health, next: nextDate.get(p.project_id) ?? null };
    });

  const line = typeof searchParams.line === "string" && (BUSINESS_LINE as readonly string[]).includes(searchParams.line) ? (searchParams.line as BusinessLine) : null;
  const lines = BUSINESS_LINE.filter((l) => rows.some((r) => r.business_line === l));
  const visible = line ? rows.filter((r) => r.business_line === line) : rows;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        actions={
          role !== "viewer" && (
            <DrawerButton label={t.add} title={t.addTitle} action={createProject} variant="primary" size="md">
              <ProjectFields />
            </DrawerButton>
          )
        }
        overflow={
          <>
            <MenuLink href="/projects/revenue-plans">{t.revenuePlans}</MenuLink>
            <MenuLink href="/projects/properties">{t.properties}</MenuLink>
            <MenuLink href="/projects/deals">{t.deals}</MenuLink>
            <MenuLink href="/collab">{t.collab}</MenuLink>
          </>
        }
      />

      {lines.length > 1 && (
        <Toolbar label={t.filter}>
          <FilterChip href={withParams("/projects", searchParams, { line: null })} active={!line} count={rows.length}>
            {t.all}
          </FilterChip>
          {lines.map((l) => (
            <FilterChip key={l} href={withParams("/projects", searchParams, { line: l })} active={line === l} count={rows.filter((r) => r.business_line === l).length}>
              {el.reports.businessLines[l]}
            </FilterChip>
          ))}
        </Toolbar>
      )}

      <DataTable
        rows={visible}
        rowKey={(r) => r.project_id}
        rowHref={(r) => `/projects/${r.project_id}`}
        empty={t.empty}
        columns={[
          {
            key: "project",
            header: t.project,
            primary: true,
            cell: (r) => (
              <span className="inline-flex items-center gap-2">
                <StatusDot tone={r.health} label={t.health[r.health]} showLabel={false} />
                <span>
                  {r.display_name}
                  <span className="ml-2 text-small text-muted">{r.code}</span>
                </span>
              </span>
            ),
          },
          { key: "line", header: t.line, cell: (r) => (r.business_line ? el.reports.businessLines[r.business_line] : "—") },
          { key: "status", header: t.status, cell: (r) => (r.status ? el.project.statusValues[r.status as ProjectStatus] : "—") },
          { key: "budget", header: t.budget, numeric: true, cell: (r) => (r.hasBudget ? money0(r.total_budget) : "—") },
          {
            key: "remaining",
            header: t.remaining,
            numeric: true,
            cell: (r) =>
              r.hasBudget ? <span className={Number(r.remaining_budget ?? 0) < 0 ? "text-negative" : undefined}>{money0(r.remaining_budget)}</span> : "—",
          },
          { key: "next", header: t.next, numeric: true, cell: (r) => (r.next ? formatDate(r.next) : "—") },
        ]}
      />
    </div>
  );
}
