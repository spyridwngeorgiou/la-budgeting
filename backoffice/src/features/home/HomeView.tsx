import Link from "next/link";
import type { ReactNode } from "react";
import {
  Amount,
  ButtonLink,
  DataTable,
  EmptyState,
  GlancePanel,
  PageHeader,
  SectionHeader,
  Sparkline,
  Stat,
  StatRow,
  StatusDot,
  Worklist,
  WorklistItem,
  type Column,
  type Severity,
  type Tone,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { countPendingChanges } from "@/lib/data/pendingChanges";
import { loadPendingCaptures } from "@/lib/ingest/pendingCaptures";
import { dayMonthLabel, monthKeyOf, monthLabel, shortMonthLabel, todayAthens } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { home } from "@/lib/i18n/v2/home";
import { withParams } from "@/lib/url";
import { longDateLabel, type Health, type LineMonth } from "./model";
import { loadHome, type HomeData } from "./queries";

// «Σήμερα», the v2 home at "/": the glance panel (first on phones, the
// right column from xl up), then what is due, open money, the worklist,
// the month by business line and the active projects.

const money = (v: number) => <Amount value={v} format={formatMoney} />;
const TIER_SEVERITY: Record<number, Severity> = { 1: "urgent", 2: "attention", 3: "info" };
const HEALTH_TONE: Record<Health, Tone> = { ok: "positive", overrun: "negative", lineOverrun: "warning", overdue: "warning" };
const lineName = (line: string) => el.reports.businessLines[line as keyof typeof el.reports.businessLines] ?? line;

export async function HomeView() {
  const access = await getAccessContext();
  if (access.kind !== "internal") return null; // the (app) layout already redirected
  const { orgId, role } = access.membership;
  const canApprove = role !== "viewer";
  const supabase = await createClient();
  const today = todayAthens();
  const [data, changes, captures] = await Promise.all([
    loadHome(supabase, orgId, today),
    canApprove ? countPendingChanges(orgId) : 0,
    canApprove ? loadPendingCaptures(supabase, orgId).then((p) => p.count) : 0,
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={longDateLabel(today)}
        title={home.title}
        actions={
          canApprove && (
            <ButtonLink href="/inbox" variant="primary">
              {home.approve} ({changes + captures})
            </ButtonLink>
          )
        }
      />
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_var(--spacing-glance)]">
        <Glance data={data} />
        <div className="flex min-w-0 flex-col gap-12 xl:col-start-1 xl:row-start-1">
          <Agenda data={data} today={today} />
          <OpenMoney data={data} />
          <Todo items={data.worklist} />
          <MonthByLine data={data} />
          <Projects items={data.projects} />
        </div>
      </div>
    </div>
  );
}

function Glance({ data }: { data: HomeData }) {
  const m = (iso: string) => monthLabel(monthKeyOf(iso));
  return (
    <GlancePanel
      className="xl:sticky xl:top-[calc(var(--spacing-topbar)+2rem)] xl:col-start-2 xl:row-start-1 xl:self-start"
      items={[
        {
          label: home.glance.cashNow,
          value: formatMoney(data.cash.total),
          sub: `${home.glance.corporate} ${formatMoney(data.cash.corporate)} · ${home.glance.personal} ${formatMoney(data.cash.personal)}`,
        },
        ...(data.lowest ? [{ label: home.glance.lowest, value: formatMoney(data.lowest.closing), sub: m(data.lowest.month) }] : []),
        {
          label: home.glance.belowBuffer,
          value: data.firstBelow ? m(data.firstBelow) : home.glance.neverBelow,
          sub: `${home.glance.buffer} ${formatMoney(data.buffer)}`,
        },
        { label: home.glance.vatDue, value: formatMoney(data.vatDue) },
        { label: home.glance.activeProjects, value: String(data.projects.length) },
      ]}
      footer={
        data.forecast.length > 0 && (
          <Link href="/reports/cash" className="flex items-center justify-between gap-3 hover:underline">
            <span>
              {home.glance.forecast} {shortMonthLabel(monthKeyOf(data.forecast[0].month))}–
              {shortMonthLabel(monthKeyOf(data.forecast[data.forecast.length - 1].month))}
            </span>
            <Sparkline onPanel values={data.forecast.map((f) => f.closing)} label={home.glance.sparkline} width={120} height={32} />
          </Link>
        )
      }
    />
  );
}

function Section({ n, title, actions, children }: { n: number; title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader numeral={n} title={title} actions={actions} />
      {children}
    </section>
  );
}

function Agenda({ data, today }: { data: HomeData; today: string }) {
  return (
    <Section
      n={1}
      title={home.agenda.title}
      actions={<span className="text-small text-muted">{`${home.agenda.all} ${dayMonthLabel(data.until)}`}</span>}
    >
      {data.agenda.length === 0 ? (
        <EmptyState title={home.agenda.empty} />
      ) : (
        <Worklist label={home.agenda.title}>
          {data.agenda.map((a) => (
            <WorklistItem
              key={a.key}
              severity={a.severity}
              title={a.label}
              meta={[
                `${a.overdue ? home.agenda.overdueSince : home.agenda.due} ${dayMonthLabel(a.dueDate)}${a.dueDate.slice(0, 4) !== today.slice(0, 4) ? ` ${a.dueDate.slice(0, 4)}` : ""}`,
                a.meta,
                a.probability < 1 && `${home.agenda.expected} ${Math.round(a.probability * 100)}%`,
              ]
                .filter(Boolean)
                .join(" · ")}
              amount={money(a.amount)}
              href={a.href}
            />
          ))}
        </Worklist>
      )}
      {data.agendaMore > 0 && (
        <Link href={withParams("/transactions", {}, { status: "pending" })} className="text-small text-muted hover:underline">
          +{data.agendaMore} {home.agenda.more} →
        </Link>
      )}
    </Section>
  );
}

function OpenMoney({ data }: { data: HomeData }) {
  const open = (direction: "income" | "expense") => withParams("/transactions", {}, { direction, status: "pending" });
  return (
    <Section n={2} title={home.open.title}>
      <StatRow>
        <Link href={open("income")} className="hover:bg-hover">
          <Stat label={home.open.receivables} value={money(data.receivables)} sub={home.open.receivablesSub} />
        </Link>
        <Link href={open("expense")} className="hover:bg-hover">
          <Stat label={home.open.payables} value={money(-data.payables)} sub={home.open.payablesSub} />
        </Link>
      </StatRow>
    </Section>
  );
}

function Todo({ items }: { items: HomeData["worklist"] }) {
  const item = (w: HomeData["worklist"][number]) => (
    <WorklistItem
      key={w.code}
      severity={TIER_SEVERITY[w.tier] ?? "info"}
      title={home.todo.labels[w.code] ?? w.code}
      count={w.count}
      amount={w.amount === null ? undefined : money(w.amount)}
      href={w.href}
    />
  );
  const main = items.filter((w) => w.tier < 3);
  const rest = items.filter((w) => w.tier >= 3);
  return (
    <Section n={3} title={home.todo.title}>
      {items.length === 0 && <EmptyState title={home.todo.empty} />}
      {main.length > 0 && <Worklist label={home.todo.title}>{main.map(item)}</Worklist>}
      {rest.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer items-center justify-between border-b border-hairline py-3 text-body text-ink hover:bg-hover">
            <span>
              {home.todo.housekeeping} <span className="num text-muted">({rest.reduce((s, w) => s + w.count, 0)})</span>
            </span>
            <span aria-hidden="true" className="text-muted group-open:rotate-90">
              →
            </span>
          </summary>
          <Worklist label={home.todo.housekeeping}>{rest.map(item)}</Worklist>
        </details>
      )}
    </Section>
  );
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="num">0</span>;
  return (
    <span className="num">
      <span aria-hidden="true">{value > 0 ? "▲ " : "▼ "}</span>
      <span className="sr-only">{value > 0 ? home.month.up : home.month.down} </span>
      {money(value)}
    </span>
  );
}

const LINE_COLUMNS: Column<LineMonth>[] = [
  { key: "line", header: home.month.line, cell: (r) => lineName(r.line), primary: true },
  { key: "revenue", header: home.month.revenue, cell: (r) => money(r.revenue), numeric: true },
  { key: "cost", header: home.month.cost, cell: (r) => money(r.cost), numeric: true },
  { key: "result", header: home.month.result, cell: (r) => money(r.result), numeric: true },
  { key: "previous", header: home.month.previous, cell: (r) => money(r.previous), numeric: true, hideOnCard: true },
  { key: "delta", header: home.month.delta, cell: (r) => <Delta value={r.delta} />, numeric: true },
];

function MonthByLine({ data }: { data: HomeData }) {
  const sum = (k: "revenue" | "cost" | "result" | "delta" | "previous") => data.lines.reduce((s, r) => s + r[k], 0);
  return (
    <Section
      n={4}
      title={home.month.title}
      actions={
        <Link href="/reports/pnl?by=line" className="text-small text-muted hover:underline">
          {monthLabel(data.month)} · {el.reports.pnlTitle} →
        </Link>
      }
    >
      <DataTable
        rows={data.lines}
        columns={LINE_COLUMNS}
        rowKey={(r) => r.line}
        empty={home.month.empty}
        totals={
          data.lines.length > 1
            ? {
                revenue: money(sum("revenue")),
                cost: money(sum("cost")),
                result: money(sum("result")),
                delta: <Delta value={sum("delta")} />,
                previous: money(sum("previous")),
              }
            : undefined
        }
      />
    </Section>
  );
}

function Projects({ items }: { items: HomeData["projects"] }) {
  return (
    <Section
      n={5}
      title={home.projects.title}
      actions={
        <Link href="/projects" className="text-small text-muted hover:underline">
          {home.all} →
        </Link>
      }
    >
      {items.length === 0 ? (
        <EmptyState title={home.projects.empty} />
      ) : (
        <ul className="grid border-t border-hairline sm:grid-cols-2 sm:gap-x-8 2xl:grid-cols-3">
          {items.map((p) => (
            <li key={p.id} className="border-b border-hairline">
              <Link href={`/projects/${p.id}`} className="flex flex-col gap-1.5 py-3 hover:bg-hover">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-body text-ink">
                    <span className="num text-muted">{p.code}</span> {p.name}
                  </span>
                  <StatusDot tone={HEALTH_TONE[p.health]} label={home.projects.health[p.health]} showLabel={p.health !== "ok"} />
                </span>
                <span className="flex flex-wrap justify-between gap-x-4 text-small text-muted">
                  <span>
                    {p.totalBudget > 0 ? (
                      <>
                        {home.projects.remaining} {money(p.remaining)}
                      </>
                    ) : (
                      home.projects.noBudget
                    )}
                  </span>
                  <span>
                    {home.projects.next} <span className="num">{p.next ? dayMonthLabel(p.next) : home.projects.none}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
