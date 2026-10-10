// Filters are URLs. withParams() builds a link that changes some query
// params and KEEPS the others, so picking a status chip never drops the
// project / account / date filters already applied.
//
//   withParams("/transactions", { project_id: "p1", status: "paid" }, { status: "pending" })
//     -> "/transactions?project_id=p1&status=pending"
//   withParams("/transactions", current, { status: null })   // remove one
//
// `current` is a page's searchParams (or a URLSearchParams); a change of
// null / undefined / "" removes the key. Array values repeat the key.

type ParamValue = string | string[] | null | undefined;

export function withParams(
  path: string,
  current: Record<string, ParamValue> | URLSearchParams,
  changes: Record<string, ParamValue> = {},
): string {
  const out = new URLSearchParams();
  const entries: [string, ParamValue][] =
    current instanceof URLSearchParams
      ? [...new Set(current.keys())].map((k) => [k, current.getAll(k)])
      : Object.entries(current);
  const merged = new Map<string, ParamValue>(entries);
  for (const [k, v] of Object.entries(changes)) merged.set(k, v);

  for (const [k, v] of merged) {
    const values = Array.isArray(v) ? v : [v];
    for (const one of values) if (one !== null && one !== undefined && one !== "") out.append(k, one);
  }
  const qs = out.toString();
  return qs ? `${path}?${qs}` : path;
}
