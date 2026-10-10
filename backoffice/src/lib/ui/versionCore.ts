// The «Νέα / Κλασική εμφάνιση» switch, as pure logic (tested in
// version.test.ts; read on the server by version.ts).
//
//   1. the kansha_ui cookie (set from the user menu), if it is v1 or v2;
//   2. else the environment default: UI_DEFAULT for staff, COLLAB_UI_DEFAULT
//      for external partners (wrangler.jsonc vars; partners move only after
//      a test with a partner account on staging);
//   3. else v1.

export type UiVersion = "v1" | "v2";
export type UiScope = "app" | "collab";

export const UI_COOKIE = "kansha_ui";

const isVersion = (v: unknown): v is UiVersion => v === "v1" || v === "v2";

export function resolveUiVersion(
  cookie: string | undefined,
  scope: UiScope,
  env: Record<string, string | undefined>,
): UiVersion {
  if (isVersion(cookie)) return cookie;
  const fallback = scope === "collab" ? env.COLLAB_UI_DEFAULT : env.UI_DEFAULT;
  return isVersion(fallback) ? fallback : "v1";
}

export function parseUiVersion(value: unknown): UiVersion | null {
  return isVersion(value) ? value : null;
}
