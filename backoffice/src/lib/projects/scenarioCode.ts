// A new scenario's code, sort order and whether it becomes the base.
//
// project_scenarios is unique on (org_id, project_id, code) and allows one
// base per project (0021). The first scenario of a project is «base» and
// the base; every later one gets the next free «sN» and is an alternative,
// unless the project has no base at all (then it becomes the base).
export function planNewScenario(existing: { code: string; is_base: boolean; sort_order?: number | null }[]): {
  code: string;
  is_base: boolean;
  sort_order: number;
} {
  const hasBase = existing.some((s) => s.is_base);
  const codes = new Set(existing.map((s) => s.code));
  const sort_order = existing.reduce((max, s) => Math.max(max, Number(s.sort_order ?? 0)), -1) + 1;
  if (existing.length === 0 || (!hasBase && !codes.has("base"))) return { code: "base", is_base: !hasBase, sort_order };
  let n = existing.length + 1;
  while (codes.has(`s${n}`)) n++;
  return { code: `s${n}`, is_base: !hasBase, sort_order };
}

// Which scenario the project page shows and edits: the one in ?s= when it
// belongs to the project, otherwise the base, otherwise the first (a
// project whose base was lost still shows something), otherwise none.
export function selectScenario<T extends { id: string; is_base: boolean }>(
  scenarios: readonly T[],
  requested: string | string[] | null | undefined,
): T | null {
  const wanted = Array.isArray(requested) ? requested[0] : requested;
  return (
    (wanted ? scenarios.find((s) => s.id === wanted) : undefined) ??
    scenarios.find((s) => s.is_base) ??
    scenarios[0] ??
    null
  );
}

// «αντιγραφή του …»: the assumptions a copy takes from its source. Identity
// (id, code, base, order, project, org, timestamps) is the new row's own.
export const SCENARIO_COPY_FIELDS = [
  "flat_annual_revenue",
  "revenue_plan_id",
  "adr_multiplier",
  "revenue_growth_pct",
  "opex_growth_pct",
  "growth_starts_after_operating_year",
  "discount_rate_pct",
  "dscr_covenant_min",
  "notes",
] as const;

export const OPEX_COPY_FIELDS = [
  "kind",
  "label",
  "sort_order",
  "category_id",
  "annual_amount",
  "from_operating_year",
  "to_operating_year",
  "grows_with_opex_growth",
  "note",
  "headcount",
  "monthly_wage",
  "salaries_per_year",
  "employer_contribution_pct",
  "premium_pct",
  "months_active",
  "pct_of_revenue",
] as const;

type ScenarioCopyKey = (typeof SCENARIO_COPY_FIELDS)[number];
type OpexCopyKey = (typeof OPEX_COPY_FIELDS)[number];

function pick<T, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = row[k];
  return out;
}

export function scenarioCopy<T extends Record<ScenarioCopyKey, unknown>>(source: T): Pick<T, ScenarioCopyKey> {
  return pick(source, SCENARIO_COPY_FIELDS);
}

export function opexLinesCopy<T extends Record<OpexCopyKey, unknown>>(
  lines: readonly T[],
  target: { scenarioId: string; orgId: string },
): (Pick<T, OpexCopyKey> & { scenario_id: string; org_id: string })[] {
  return lines.map((l) => ({ ...pick(l, OPEX_COPY_FIELDS), scenario_id: target.scenarioId, org_id: target.orgId }));
}

// The name a new scenario gets: what was typed, else «<source> (αντίγραφο)»
// for a copy; null when there is nothing to call it.
export function newScenarioName(typed: string | null | undefined, sourceName: string | null, copySuffix: string): string | null {
  const name = (typed ?? "").trim();
  if (name) return name.slice(0, 120);
  return sourceName ? `${sourceName} ${copySuffix}` : null;
}
