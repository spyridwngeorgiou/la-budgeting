import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { addMonths, lastOfMonth, monthKeyOf } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { BUSINESS_LINE } from "@/lib/domain/enums";
import { buildAgenda, dueWindow, monthByLine, projectHealth, signed, type AgendaItem } from "./model";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const AGENDA_LIMIT = 200;
const n = (v: number | string | null | undefined) => Number(v ?? 0);
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

// Where a forecast item (not a ledger row) is looked after today.
function forecastHref(source: string | null, projectId: string | null): string {
  if (source === "deal") return "/projects/deals";
  if (source === "vat") return "/reports/vat";
  if (source === "liability") return "/reports/net-worth";
  if (source === "drawdown" && projectId) return `/projects/${projectId}`;
  return "/reports/cash";
}

// Everything «Σήμερα» shows, read in one round of parallel queries. Every
// figure comes from the same views and functions the reports use.
export async function loadHome(supabase: Supabase, orgId: string, today: string) {
  const { until } = dueWindow(today);
  const month = monthKeyOf(today);
  const prev = addMonths(month, -1);
  const pnl = (m: string) =>
    supabase.rpc("pnl_summary", { p_org: orgId, p_from: `${m}-01`, p_to: lastOfMonth(m), p_group: "business_line" });

  const [liquidity, forecast, vat, netWorth, dueTx, dueForecast, worklist, pnlNow, pnlPrev, projects, lineOver, milestones] =
    await Promise.all([
      supabase.from("v_liquidity").select("owner_scope, balance").eq("org_id", orgId),
      supabase.rpc("cash_forecast", { p_org: orgId, p_months: 12, p_scenario: "base" }),
      supabase
        .from("v_vat_position")
        .select("payable_after_credit")
        .eq("org_id", orgId)
        .lte("period_start", today)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("v_net_worth").select("receivables_total, payables_total").eq("org_id", orgId).maybeSingle(),
      // No lower bound on due_date (see dueWindow).
      supabase
        .from("transactions")
        .select("id, due_date, direction, gross_amount, description, counterparty_name, contacts(name), projects(display_name)", {
          count: "exact",
        })
        .eq("org_id", orgId)
        .in("status", ["pending", "scheduled"])
        .not("due_date", "is", null)
        .lte("due_date", until)
        .order("due_date")
        .limit(AGENDA_LIMIT),
      supabase
        .from("v_cash_forecast_items")
        .select("item_key, source, project_id, label, due_date, direction, amount, probability")
        .eq("org_id", orgId)
        .not("item_key", "like", "tx:%")
        .lte("due_date", until)
        .order("due_date")
        .limit(AGENDA_LIMIT),
      supabase.from("v_worklist").select("tier, code, label_key, count, amount, href").eq("org_id", orgId).order("tier"),
      pnl(month),
      pnl(prev),
      supabase
        .from("v_project_rollup")
        .select("project_id, code, display_name, total_budget, remaining_budget")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("code"),
      supabase.from("v_project_budget_lines").select("project_id").eq("org_id", orgId).lt("remaining", 0),
      supabase.from("project_milestones").select("project_id, due_date").eq("org_id", orgId).is("done_at", null).order("due_date"),
    ]);

  const cash = { corporate: 0, personal: 0, total: 0 };
  for (const l of liquidity.data ?? []) {
    if (l.owner_scope === "personal") cash.personal += n(l.balance);
    else cash.corporate += n(l.balance);
    cash.total += n(l.balance);
  }

  const months = forecast.data ?? [];
  const lowest = months.reduce<(typeof months)[number] | null>((lo, m) => (!lo || m.closing_balance < lo.closing_balance ? m : lo), null);

  const items: AgendaItem[] = [
    ...(dueTx.data ?? []).map((t) => {
      const project = one(t.projects)?.display_name;
      const who = one(t.contacts)?.name ?? t.counterparty_name;
      return {
        key: `tx:${t.id}`,
        label: t.description?.trim() || who || el.reports.sources.open,
        meta: [who, project].filter(Boolean).join(" · ") || null,
        dueDate: t.due_date!,
        amount: signed(t.direction, t.gross_amount),
        probability: 1,
        href: `/transactions?ids=${t.id}`,
      };
    }),
    ...(dueForecast.data ?? []).map((i) => ({
      key: i.item_key ?? "",
      label: i.label || el.reports.sources[(i.source ?? "expected") as keyof typeof el.reports.sources],
      meta: el.reports.sources[(i.source ?? "expected") as keyof typeof el.reports.sources] ?? null,
      dueDate: i.due_date ?? today,
      amount: signed(i.direction, i.amount),
      probability: n(i.probability ?? 1),
      href: forecastHref(i.source, i.project_id),
    })),
  ];

  const overLines = new Set((lineOver.data ?? []).map((r) => r.project_id));
  const projectRows = (projects.data ?? []).map((p) => {
    const open = (milestones.data ?? []).filter((m) => m.project_id === p.project_id);
    return {
      id: p.project_id!,
      code: p.code ?? "",
      name: p.display_name ?? "",
      totalBudget: n(p.total_budget),
      remaining: n(p.remaining_budget),
      next: open.find((m) => m.due_date >= today)?.due_date ?? null,
      health: projectHealth({
        totalBudget: n(p.total_budget),
        remaining: n(p.remaining_budget),
        lineOverrun: overLines.has(p.project_id),
        overdueMilestone: open.some((m) => m.due_date < today),
      }),
    };
  });

  return {
    cash,
    forecast: months.map((m) => ({ month: m.month, closing: n(m.closing_balance) })),
    lowest: lowest && { month: lowest.month, closing: n(lowest.closing_balance) },
    firstBelow: months.find((m) => m.below_buffer)?.month ?? null,
    buffer: n(months[0]?.min_buffer),
    vatDue: n(vat.data?.payable_after_credit),
    receivables: n(netWorth.data?.receivables_total),
    payables: n(netWorth.data?.payables_total),
    agenda: buildAgenda(items, today, until),
    agendaMore: Math.max((dueTx.count ?? 0) - AGENDA_LIMIT, 0),
    until,
    worklist: (worklist.data ?? []).map((w) => ({
      tier: n(w.tier),
      code: w.label_key ?? w.code ?? "",
      count: n(w.count),
      amount: w.amount === null ? null : n(w.amount),
      href: w.href ?? "/reports/quality",
    })),
    lines: monthByLine(pnlNow.data ?? [], pnlPrev.data ?? [], BUSINESS_LINE),
    month,
    prev,
    projects: projectRows,
  };
}

export type HomeData = Awaited<ReturnType<typeof loadHome>>;
