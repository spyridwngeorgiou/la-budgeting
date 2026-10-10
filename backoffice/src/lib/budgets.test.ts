import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import budgets from "./budgets.json";

// The number of (app) pages never grows (see budgets.json).

const SRC = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("page budget", () => {
  const appPages = walk(path.join(SRC, "app", "(app)")).filter((f) => f.endsWith(`${path.sep}page.tsx`));

  it(`(app) has at most ${budgets.appPagesMax} pages`, () => {
    expect(appPages.length).toBeLessThanOrEqual(budgets.appPagesMax);
  });
});
