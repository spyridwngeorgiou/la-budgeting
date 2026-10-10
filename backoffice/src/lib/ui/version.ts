import "server-only";
import { cookies } from "next/headers";
import { resolveUiVersion, UI_COOKIE, type UiScope, type UiVersion } from "./versionCore";

export type { UiVersion, UiScope } from "./versionCore";

// Which shell this request renders: the v2 AppShell or the classic Nav.
// See versionCore.ts for the order (cookie, then env default, then v1).
export async function getUiVersion(scope: UiScope = "app"): Promise<UiVersion> {
  const store = await cookies();
  return resolveUiVersion(store.get(UI_COOKIE)?.value, scope, process.env);
}
