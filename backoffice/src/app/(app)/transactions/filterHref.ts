import { withParams } from "@/lib/url";

// The URLs of the /transactions filter row. Every change starts from ALL the
// page's current params -- the search (?q=), an ?ids= drill-down, the other
// filters -- and changes only its own key, so picking a project never drops
// what was typed in the search box (it used to: the row rebuilt the URL from
// its own filters only). Page 1 and no «new» form on every change.

export type TxParams = Record<string, string | string[] | undefined>;

// The filters the «Φίλτρα (n)» count and «Καθαρισμός» are about. The
// search box and an ?ids= list are shown on their own (always in sight).
export const TX_FILTER_KEYS = [
  "direction",
  "status",
  "project_id",
  "category_id",
  "account_id",
  "contact_id",
  "scope",
] as const;

export const TX_BASE = "/transactions";

export function txFilterHref(params: TxParams, changes: Record<string, string | null | undefined>): string {
  return withParams(TX_BASE, params, { ...changes, page: null, new: null });
}

const has = (v: string | string[] | undefined) => (Array.isArray(v) ? v.some(Boolean) : !!v);

// Active filters, the period (from / to) counting once.
export function activeFilterCount(params: TxParams): number {
  return TX_FILTER_KEYS.filter((k) => has(params[k])).length + (has(params.from) || has(params.to) ? 1 : 0);
}

// Anything to clear: a filter, the search or an ?ids= list.
export function hasAnyFilter(params: TxParams): boolean {
  return activeFilterCount(params) > 0 || has(params.q) || has(params.ids);
}
