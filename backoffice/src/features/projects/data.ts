import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { todayAthens } from "@/lib/dates";
import { computeScenarioFromInputs, loadProjectFlows, loadScenarioInputs } from "@/lib/finance/projectModel";
import { computeDevelopmentResult } from "@/lib/finance/development";
import { el } from "@/lib/i18n/el";
import type { OrgRole } from "@/lib/domain/enums";
import { notFound, redirect } from "next/navigation";
import { fallbackTab, tabAllowed, type ProjectTab } from "./tabs";

// What the v2 project page reads, once per request: the layout's header
// «Με μια ματιά» and the tab below it call the same cached loaders, so a
// figure in the header and the same figure in a tab can never disagree.
// Every number comes from the existing finance layer (v_project_rollup,
// projectModel.ts, development.ts); nothing is computed twice.

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface DateItem {
  key: string;
  date: string;
  title: string;
  kind: string;
  amount: number | null;
  direction: string | null;
}

// v_calendar_items (0042) already merges tasks, milestones, phases, project
// key dates, open payments, instalments, lease and loan dates.
function dateTitle(r: { source: string | null; subkind: string | null; title: string | null }): { title: string; kind: string } {
  const source = (r.source ?? "") as keyof typeof el.planner.source;
  const subkind = r.subkind as keyof typeof el.planner.subkind | null;
  const kind = el.planner.source[source] ?? r.source ?? "";
  const sub = subkind && subkind in el.planner.subkind ? el.planner.subkind[subkind] : null;
  return { title: sub ? `${sub} · ${r.title ?? ""}` : (r.title ?? ""), kind };
}

export const loadNextDates = cache(async (projectId: string, limit = 5): Promise<DateItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_calendar_items")
    .select("item_key, source, subkind, title, starts_on, amount, direction")
    .eq("project_id", projectId)
    .eq("is_done", false)
    .gte("starts_on", todayAthens())
    .order("starts_on")
    .limit(limit);
  return (data ?? []).map((r) => ({
    key: r.item_key ?? `${r.source}:${r.starts_on}`,
    date: r.starts_on ?? "",
    amount: r.amount == null ? null : Number(r.amount),
    direction: r.direction,
    ...dateTitle(r),
  }));
});

export const loadProjectCore = cache(async (projectId: string) => {
  const supabase = await createClient();
  const today = todayAthens();
  const [access, { data: rollup }, { data: project }, inputs, { data: budget }, { data: noBudget }, { data: capital }, flows, nextDates] =
    await Promise.all([
      getAccessContext(),
      supabase.from("v_project_rollup").select("*").eq("project_id", projectId).maybeSingle(),
      supabase
        .from("projects")
        .select("opening_date, phase, units, project_type, start_date, business_model, contract_value, contract_signed_date")
        .eq("id", projectId)
        .maybeSingle(),
      // Every scenario (the Σενάρια tab compares them); the header uses the base.
      loadScenarioInputs(supabase, projectId),
      supabase
        .from("project_budgets")
        .select("contingency_pct, notes, budget_lines(line_code, amount)")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .maybeSingle(),
      supabase.from("v_qc_projects_without_budget").select("project_id").eq("project_id", projectId).maybeSingle(),
      supabase
        .from("project_capital_sources")
        .select("id, kind, contributor, amount, contributed_on, notes")
        .eq("project_id", projectId)
        .order("contributed_on"),
      loadProjectFlows(supabase, projectId, today),
      loadNextDates(projectId),
    ]);
  if (!rollup || !inputs) return null;

  const hasBudget = !noBudget;
  const results = inputs.scenarios.map((scenario) => ({ scenario, result: computeScenarioFromInputs(inputs, scenario) }));
  const base = results.find((r) => r.scenario.is_base) ?? null;
  // IRR έργου: every project flow net of VAT, before financing, plus the
  // budget not yet committed -- the same run the Οικονομικά tab shows.
  const development = computeDevelopmentResult(flows.flows, {
    today,
    remainingBudget: hasBudget ? Math.max(0, Number(rollup.remaining_budget ?? 0)) : 0,
  });
  const capitalRows = (capital ?? []).map((c) => ({ ...c, amount: Number(c.amount) }));
  const role: OrgRole | "partner" | null =
    access.kind === "internal" ? access.membership.role : access.kind === "partner" ? "partner" : null;

  return {
    id: projectId,
    supabase,
    today,
    role,
    canEdit: role !== null && role !== "viewer" && role !== "partner",
    isAdmin: role === "admin" || role === "owner",
    rollup,
    project,
    budget,
    hasBudget,
    inputs,
    results,
    base,
    development,
    flowsTruncated: flows.truncated,
    capitalRows,
    capitalTotal: capitalRows.reduce((s, c) => s + c.amount, 0),
    loansTotal: inputs.loans.reduce((s, l) => s + Number(l.principal), 0),
    nextDates,
  };
});

export type ProjectCore = NonNullable<Awaited<ReturnType<typeof loadProjectCore>>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isProjectId = (id: string) => UUID.test(id);

// Every tab starts here: a project the caller can read (RLS) or a 404, and
// a tab their role may see or a redirect to one they may (partners: only
// Πλάνο and Συνεργασία).
export async function requireTab(projectId: string, tab: ProjectTab): Promise<ProjectCore> {
  if (!isProjectId(projectId)) notFound();
  const core = await loadProjectCore(projectId);
  if (!core) notFound();
  if (!tabAllowed(tab, core.role)) redirect(fallbackTab(projectId, core.role));
  return core;
}
