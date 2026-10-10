"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { parseUiVersion, UI_COOKIE, type UiVersion } from "./versionCore";

// «Νέα / Κλασική εμφάνιση»: remembers the choice for a year on this browser
// and re-renders every layout, so the shell swaps without a reload. Takes
// a version (bound / called directly) or a form with a `version` field.
export async function setUiVersion(input: UiVersion | FormData): Promise<void> {
  const version = parseUiVersion(input instanceof FormData ? input.get("version") : input);
  if (!version) return;
  const store = await cookies();
  store.set(UI_COOKIE, version, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}
