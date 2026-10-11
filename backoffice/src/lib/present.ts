// Presentation mode (components/PresentMode.tsx): the URL flag and the
// slide order. Pure, so it is tested without a browser.

export const PRESENT_PARAM = "present";

// The «slides»: the overview, then the report tabs in reading order.
// ← from the first report goes back to the overview, → from the last too.
export const PRESENT_STEPS = [
  "/dashboard",
  "/reports/cash",
  "/reports/pnl",
  "/reports/net-worth",
  "/reports/vat",
  "/reports/withholding",
  "/reports/quality",
  "/reports/portfolio",
] as const;

export function isPresenting(search: URLSearchParams | { get(name: string): string | null } | null | undefined): boolean {
  return search?.get(PRESENT_PARAM) === "1";
}

// Where ← and → go from `pathname`; null off the sequence (a project page).
export function presentNeighbours(pathname: string): { index: number; prev: string; next: string } | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const index = PRESENT_STEPS.findIndex((p) => path === p || path.startsWith(`${p}/`));
  if (index < 0) return null;
  const n = PRESENT_STEPS.length;
  return { index, prev: PRESENT_STEPS[(index - 1 + n) % n], next: PRESENT_STEPS[(index + 1) % n] };
}

// `href` with ?present=1 added (other params kept, hash kept).
export function withPresent(href: string): string {
  const [beforeHash, hash] = splitHash(href);
  const [path, query = ""] = beforeHash.split("?");
  const params = new URLSearchParams(query);
  params.set(PRESENT_PARAM, "1");
  return `${path}?${params.toString()}${hash}`;
}

// `pathname` + `search` without the flag: the exit link.
export function withoutPresent(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PRESENT_PARAM);
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

// Whether a same-origin link should carry the flag: app pages only, never
// API routes (CSV exports), auth or static files.
export function carriesPresent(pathname: string): boolean {
  return !/^\/(api|auth|login|logout|_next|brand)(\/|$)/.test(pathname) && !/\.[a-z0-9]+$/i.test(pathname);
}

function splitHash(href: string): [string, string] {
  const i = href.indexOf("#");
  return i < 0 ? [href, ""] : [href.slice(0, i), href.slice(i)];
}
