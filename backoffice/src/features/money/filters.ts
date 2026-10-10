import { TX_DIRECTION, TX_STATUS, type TxDirection, type TxStatus } from "@/lib/domain/enums";
import { withParams } from "@/lib/url";

// The filters of «Κινήσεις», all in the URL. Every chip is a link built
// with withParams(), so choosing one keeps every other filter; the saved
// views are named combinations of the same parameters (not a second filter
// system), so a view and a status chip can never contradict each other.

export type Params = Record<string, string | string[] | undefined>;

export interface TxFilters {
  status: TxStatus | null;
  direction: TxDirection | null;
  project_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  category_id: string | null;
  scope: "business" | "personal" | null;
  from: string | null;
  to: string | null;
  q: string | null;
  // "1": open rows past their due date.
  overdue: boolean;
  // "any": every instalment row; or one plan's id.
  plan: string | null;
  // An explicit id list (the assistant's drill-down links).
  ids: string[] | null;
}

// The filter parameters; everything else in the URL (edit=, pay=, new=)
// is UI state that a filter link must drop.
export const FILTER_KEYS = [
  "status", "direction", "project_id", "account_id", "contact_id", "category_id", "scope", "from", "to", "q", "overdue", "plan", "ids",
] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f-]{8,36}$/i;
const id = (v: string | string[] | undefined) => {
  const s = one(v);
  return s && ID.test(s) ? s : null;
};

export function parseTxFilters(sp: Params): TxFilters {
  const status = one(sp.status);
  const direction = one(sp.direction);
  const scope = one(sp.scope);
  const from = one(sp.from);
  const to = one(sp.to);
  const plan = one(sp.plan);
  const ids = one(sp.ids)?.split(",").filter((x) => ID.test(x)) ?? [];
  return {
    status: (TX_STATUS as readonly string[]).includes(status ?? "") ? (status as TxStatus) : null,
    direction: (TX_DIRECTION as readonly string[]).includes(direction ?? "") ? (direction as TxDirection) : null,
    project_id: id(sp.project_id),
    account_id: id(sp.account_id),
    contact_id: id(sp.contact_id),
    category_id: id(sp.category_id),
    scope: scope === "business" || scope === "personal" ? scope : null,
    from: from && ISO.test(from) ? from : null,
    to: to && ISO.test(to) ? to : null,
    q: searchTerm(one(sp.q)),
    overdue: one(sp.overdue) === "1",
    plan: plan === "any" || (plan && ID.test(plan)) ? plan : null,
    ids: ids.length ? ids : null,
  };
}

// The free-text search, safe inside a PostgREST or() filter: the
// characters that structure the filter (, . ( ) and the wildcards) are
// dropped, not escaped.
export function searchTerm(q: string | null | undefined): string | null {
  const s = (q ?? "").replace(/[,.()%*\\:"']/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 80) : null;
}

// Only the filter parameters of the current URL (for chip links).
export function filterParams(sp: Params): Record<string, string | undefined> {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, one(sp[k]) ?? undefined]));
}

export const SAVED_VIEWS = {
  receivables: { direction: "income", status: "pending" },
  payables: { direction: "expense", status: "pending" },
  overdue: { overdue: "1" },
  instalments: { plan: "any" },
} as const satisfies Record<string, Partial<Record<(typeof FILTER_KEYS)[number], string>>>;
export type SavedView = keyof typeof SAVED_VIEWS;

export function isViewActive(sp: Params, view: SavedView): boolean {
  return Object.entries(SAVED_VIEWS[view]).every(([k, v]) => one(sp[k]) === v);
}

// A saved view's chip: on -> adds its parameters (keeping the rest), off
// -> removes exactly its own.
export function viewHref(path: string, sp: Params, view: SavedView): string {
  const own = SAVED_VIEWS[view] as Record<string, string>;
  const active = isViewActive(sp, view);
  const changes = Object.fromEntries(Object.entries(own).map(([k, v]) => [k, active ? null : v]));
  return withParams(path, filterParams(sp), changes);
}

// One chip of a single-valued filter (status, direction …): its value, or
// null for «Όλες».
export function chipHref(path: string, sp: Params, key: (typeof FILTER_KEYS)[number], value: string | null): string {
  return withParams(path, filterParams(sp), { [key]: value });
}

export const hasFilters = (sp: Params) => FILTER_KEYS.some((k) => !!one(sp[k]));
