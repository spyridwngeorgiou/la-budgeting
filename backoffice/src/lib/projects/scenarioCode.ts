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
