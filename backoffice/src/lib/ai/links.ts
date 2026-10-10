// «Πηγές» for an assistant answer: links into the app, built on the server
// from what the tools actually read -- never from text the model wrote. A
// figure in the answer is one click away from the rows or report behind it.
//
// Pure (no Supabase, no SDK) so vitest covers it.

export interface TxFilter {
  from?: string | null;
  to?: string | null;
  direction?: "income" | "expense" | null;
  scope?: "business" | "personal" | null;
  status?: "paid" | "pending" | "scheduled" | "cancelled" | null;
  project_id?: string | null;
  contact_id?: string | null;
  category_id?: string | null;
  account_id?: string | null;
}

export type SourceRef =
  // Transactions behind a figure. With a short id list the link pins exactly
  // those rows; otherwise it is the filter that produced them, so a long
  // answer never turns into a 4 KB ?ids= URL.
  | { kind: "transactions"; label: string; filter: TxFilter; ids?: string[] }
  | { kind: "project"; id: string; label: string }
  | { kind: "contact"; id: string; label: string }
  | { kind: "report"; report: "cash" | "vat" | "withholding" | "quality"; label: string }
  | { kind: "revenue_plan"; id: string; label: string }
  | { kind: "changes"; label: string };

export interface Source {
  label: string;
  href: string;
}

export const MAX_PINNED_IDS = 25;
export const MAX_SOURCES = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const FILTER_KEYS = [
  "from",
  "to",
  "direction",
  "scope",
  "status",
  "project_id",
  "contact_id",
  "category_id",
  "account_id",
] as const satisfies readonly (keyof TxFilter)[];

// Only values the /transactions page understands survive: ids must be
// uuids, dates ISO, enums known. Anything else is dropped rather than
// passed through into a URL.
function cleanFilterValue(key: keyof TxFilter, value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (key === "from" || key === "to") return ISO_DATE.test(value) ? value : null;
  if (key === "direction") return value === "income" || value === "expense" ? value : null;
  if (key === "scope") return value === "business" || value === "personal" ? value : null;
  if (key === "status") return ["paid", "pending", "scheduled", "cancelled"].includes(value) ? value : null;
  return UUID.test(value) ? value : null;
}

export function transactionsHref(filter: TxFilter, ids?: string[]): string {
  const cleanIds = (ids ?? []).filter((id) => UUID.test(id));
  if (cleanIds.length > 0 && cleanIds.length <= MAX_PINNED_IDS) {
    return `/transactions?ids=${cleanIds.join(",")}`;
  }
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = cleanFilterValue(key, filter[key]);
    if (v) params.set(key, v);
  }
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

export function hrefFor(ref: SourceRef): string | null {
  switch (ref.kind) {
    case "transactions":
      return transactionsHref(ref.filter, ref.ids);
    case "project":
      return UUID.test(ref.id) ? `/projects/${ref.id}` : null;
    case "contact":
      return UUID.test(ref.id) ? `/contacts/${ref.id}` : null;
    case "revenue_plan":
      return UUID.test(ref.id) ? `/projects/revenue-plans/${ref.id}` : null;
    case "report":
      return `/reports/${ref.report}`;
    case "changes":
      return "/assistant?panel=changes";
  }
}

// Dedupe by href (first label wins), keep tool order, cap the list.
export function buildSources(refs: SourceRef[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const ref of refs) {
    const href = hrefFor(ref);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ label: ref.label.slice(0, 120), href });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

// Stored sources come back from ai_messages.meta (written by the server,
// but a user can write their own rows): only same-app relative links pass.
export function isSafeSourceHref(href: unknown): href is string {
  return typeof href === "string" && /^\/(?!\/)[\w\-/?=&,.%]*$/.test(href);
}
