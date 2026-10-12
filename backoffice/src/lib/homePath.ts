// The pages a user may choose to open the app on (profiles.home_path, 0092).
// Same list as the check constraint in 0092_home_path.sql -- the database
// rejects anything else too, so / can never redirect to an arbitrary URL.
// Pure, so vitest covers it; used by the settings form and src/app/page.tsx.
import { el } from "@/lib/i18n/el";

// "/" itself: the tiles page (src/app/(app)/page.tsx). Stored as null, so
// the 0092 check constraint needs no change.
export const HOME_TILES_PATH = "/";
export const DEFAULT_HOME_PATH = HOME_TILES_PATH;

export const HOME_PATHS = [
  { path: "/", label: "Πλακίδια (επιλογή ενότητας)" },
  { path: "/dashboard", label: el.nav.dashboard },
  { path: "/inbox", label: el.nav.inbox },
  { path: "/transactions", label: el.nav.transactions },
  { path: "/projects", label: el.nav.projects },
  { path: "/calendar", label: el.nav.calendar },
  { path: "/planner", label: el.nav.planner },
  { path: "/reports/cash", label: el.tabs.cash },
  { path: "/accounts", label: el.nav.accounts },
] as const;

export type HomePath = (typeof HOME_PATHS)[number]["path"];

export function isHomePath(value: unknown): value is HomePath {
  return typeof value === "string" && HOME_PATHS.some((h) => h.path === value);
}

// Where / sends a signed-in internal user: their choice if it is still on
// the list, otherwise the tiles page.
export function resolveHomePath(value: unknown): HomePath {
  return isHomePath(value) ? value : DEFAULT_HOME_PATH;
}
